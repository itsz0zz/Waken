// SPDX-License-Identifier: LicenseRef-AGPL-3.0-only-OpenSSL
// Waken's bridge to chiaki (modules/waken-stream/vendor/chiaki-ng), the PlayStation Remote Play protocol.
#import "MLPlayStation.h"

#include <arpa/inet.h>
#include <netinet/in.h>

#include <chiaki/common.h>
#include <chiaki/discovery.h>
#include <chiaki/discoveryservice.h>
#include <chiaki/log.h>
#include <chiaki/regist.h>

static void LogLine(ChiakiLogLevel level, const char *msg, void *user) {
  if (level & (CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING | CHIAKI_LOG_INFO)) NSLog(@"[chiaki] %s", msg);
}

/// chiaki_lib_init, once: its crypto and sockets.
static BOOL Ready(void) {
  static BOOL ready = NO;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ ready = chiaki_lib_init() == CHIAKI_ERR_SUCCESS; });
  return ready;
}

static ChiakiLog *Log(void) {
  static ChiakiLog log;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ chiaki_log_init(&log, CHIAKI_LOG_ALL & ~CHIAKI_LOG_VERBOSE, LogLine, NULL); });
  return &log;
}

static NSString *Hex(const uint8_t *bytes, size_t size) {
  NSMutableString *hex = [NSMutableString stringWithCapacity:size * 2];
  for (size_t i = 0; i < size; i++) [hex appendFormat:@"%02x", bytes[i]];
  return hex;
}

static NSString *Text(const char *value) { return value ? [NSString stringWithUTF8String:value] ?: @"" : @""; }

#pragma mark - Discovery

/// What the discovery service saw last, the newest list replacing the previous one.
@interface MLDiscovery : NSObject
@property (atomic, copy) NSArray<NSDictionary *> *consoles;
@end
@implementation MLDiscovery
@end

static void Discovered(ChiakiDiscoveryHost *hosts, size_t count, void *user) {
  NSMutableArray *list = [NSMutableArray array];
  for (size_t i = 0; i < count; i++) {
    ChiakiDiscoveryHost *host = &hosts[i];
    NSString *state = host->state == CHIAKI_DISCOVERY_HOST_STATE_READY ? @"ready" : host->state == CHIAKI_DISCOVERY_HOST_STATE_STANDBY ? @"standby" : @"unknown";
    [list addObject:@{
      @"host" : Text(host->host_addr),
      @"name" : Text(host->host_name),
      @"id" : Text(host->host_id),
      @"ps5" : @(chiaki_discovery_host_is_ps5(host)),
      @"state" : state,
      @"systemVersion" : Text(host->system_version),
      @"app" : Text(host->running_app_name),
    }];
  }
  ((__bridge MLDiscovery *)user).consoles = list;
}

#pragma mark - Linking

/// One registration in flight: chiaki calls back from its own thread, the result goes to the main thread once.
@interface MLRegistration : NSObject {
 @public
  ChiakiRegist regist;
  char *host;
}
@property (nonatomic, copy) void (^completion)(NSDictionary *_Nullable, NSString *_Nullable);
@property (nonatomic) BOOL ps5;
@end
@implementation MLRegistration
@end

static void Registered(ChiakiRegistEvent *event, void *user) {
  MLRegistration *registration = (__bridge MLRegistration *)user;
  NSDictionary *console = nil;
  NSString *error = nil;
  if (event->type == CHIAKI_REGIST_EVENT_TYPE_FINISHED_SUCCESS && event->registered_host) {
    ChiakiRegisteredHost *host = event->registered_host;
    // The key is ASCII hex, padded with zeros to its 16 bytes.
    size_t keyLength = strnlen(host->rp_regist_key, sizeof(host->rp_regist_key));
    console = @{
      @"registKey" : [[NSString alloc] initWithBytes:host->rp_regist_key length:keyLength encoding:NSASCIIStringEncoding] ?: @"",
      @"rpKey" : Hex(host->rp_key, sizeof(host->rp_key)),
      @"rpKeyType" : @(host->rp_key_type),
      @"mac" : Hex(host->server_mac, sizeof(host->server_mac)),
      @"nickname" : [NSString stringWithUTF8String:host->server_nickname] ?: @"",
      @"ps5" : @(chiaki_target_is_ps5(host->target)),
      @"target" : @(host->target),
    };
  } else if (event->type == CHIAKI_REGIST_EVENT_TYPE_FINISHED_CANCELED) {
    error = @"Liaison annulée.";
  } else {
    error = @"La console a refusé la liaison : vérifie le code (il change à chaque ouverture de l'écran) et ton compte PSN.";
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    registration.completion(console, error);
    // chiaki_regist_fini joins chiaki's thread: not from that thread itself.
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
      chiaki_regist_fini(&registration->regist);
      free(registration->host);
      CFBridgingRelease((__bridge CFTypeRef)registration);
    });
  });
}

@implementation MLPlayStation

+ (void)discoverFor:(NSTimeInterval)seconds completion:(void (^)(NSArray<NSDictionary<NSString *, id> *> *))completion {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    MLDiscovery *found = [MLDiscovery new];
    found.consoles = @[];
    if (Ready()) {
      ChiakiDiscoveryServiceOptions options = {0};
      options.ping_ms = 500;
      options.ping_initial_ms = 50;
      options.hosts_max = 16;
      options.host_drop_pings = 3;
      options.cb = Discovered;
      options.cb_user = (__bridge void *)found;
      // The whole network's broadcast: both consoles answer it, on their own port each.
      struct sockaddr_in broadcast = {0};
      broadcast.sin_family = AF_INET;
      broadcast.sin_addr.s_addr = INADDR_BROADCAST;
      struct sockaddr_storage address = {0};
      memcpy(&address, &broadcast, sizeof(broadcast));
      options.send_addr = &address;
      options.send_addr_size = sizeof(broadcast);
      ChiakiDiscoveryService service;
      if (chiaki_discovery_service_init(&service, &options, Log()) == CHIAKI_ERR_SUCCESS) {
        [NSThread sleepForTimeInterval:seconds];
        chiaki_discovery_service_fini(&service);
      }
    }
    NSArray *consoles = found.consoles;
    dispatch_async(dispatch_get_main_queue(), ^{ completion(consoles); });
  });
}

#pragma mark Linking

+ (void)registerConsole:(NSString *)host
                    ps5:(BOOL)ps5
              accountId:(NSString *)accountId
                    pin:(NSString *)pin
             completion:(void (^)(NSDictionary<NSString *, id> *_Nullable, NSString *_Nullable))completion {
  NSData *account = [[NSData alloc] initWithBase64EncodedString:accountId options:0];
  NSString *digits = [[pin componentsSeparatedByCharactersInSet:NSCharacterSet.decimalDigitCharacterSet.invertedSet] componentsJoinedByString:@""];
  if (!Ready()) return completion(nil, @"Le protocole PlayStation n'a pas démarré.");
  if (account.length != CHIAKI_PSN_ACCOUNT_ID_SIZE) return completion(nil, @"Identifiant de compte PSN invalide : reconnecte-toi à PlayStation Network.");
  if (digits.length != 8) return completion(nil, @"Le code de liaison a 8 chiffres.");

  MLRegistration *registration = [MLRegistration new];
  registration.completion = completion;
  registration.ps5 = ps5;
  ChiakiRegistInfo info = {0};
  info.target = ps5 ? CHIAKI_TARGET_PS5_1 : CHIAKI_TARGET_PS4_10;
  registration->host = strdup(host.UTF8String);
  info.host = registration->host;
  info.broadcast = false;
  info.pin = (uint32_t)digits.integerValue;
  memcpy(info.psn_account_id, account.bytes, CHIAKI_PSN_ACCOUNT_ID_SIZE);
  // Kept alive until chiaki calls back (released in Registered).
  void *user = (void *)CFBridgingRetain(registration);
  if (chiaki_regist_start(&registration->regist, Log(), &info, Registered, user) != CHIAKI_ERR_SUCCESS) {
    free(registration->host);
    CFBridgingRelease(user);
    completion(nil, @"La liaison n'a pas pu démarrer.");
  }
}

#pragma mark - Waking

+ (nullable NSString *)wake:(NSString *)host registKey:(NSString *)registKey ps5:(BOOL)ps5 {
  if (!Ready()) return @"Le protocole PlayStation n'a pas démarré.";
  unsigned long long credential = 0;
  NSScanner *scanner = [NSScanner scannerWithString:registKey];
  if (registKey.length == 0 || registKey.length > 8 || ![scanner scanHexLongLong:&credential]) return @"Clé de liaison invalide : relie la console à nouveau.";
  ChiakiErrorCode error = chiaki_discovery_wakeup(Log(), NULL, host.UTF8String, credential, ps5);
  return error == CHIAKI_ERR_SUCCESS ? nil : [NSString stringWithFormat:@"Réveil non envoyé : %s", chiaki_error_string(error)];
}

@end
