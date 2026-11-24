// chiaki's src/aia.h names curl's handle type in declarations that common.c reads. curl itself is not built yet (it
// comes with Remote Play over the Internet); iOS has no curl header at all. To be removed once curl is in.
#ifndef WAKEN_CURL_PLACEHOLDER_H
#define WAKEN_CURL_PLACEHOLDER_H
typedef void CURL;
#endif
