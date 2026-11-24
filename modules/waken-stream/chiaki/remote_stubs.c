// SPDX-License-Identifier: LicenseRef-AGPL-3.0-only-OpenSSL
// Remote Play over the Internet through Sony's servers (chiaki's remote/holepunch.c, remote/rudp.c, aia.c) needs
// curl, json-c, miniupnpc and libevent: not built yet. On the home network these are never called; until that part
// is built, they answer that it is not there.
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <netinet/in.h>
#endif

#include <chiaki/remote/holepunch.h>
#include <chiaki/remote/rudp.h>

ChiakiErrorCode chiaki_aia_init(void);
void chiaki_aia_fini(void);
ChiakiErrorCode chiaki_aia_init(void) { return CHIAKI_ERR_SUCCESS; }
void chiaki_aia_fini(void) {}

CHIAKI_EXPORT void chiaki_holepunch_session_fini(ChiakiHolepunchSession session) { (void)session; }
CHIAKI_EXPORT ChiakiErrorCode chiaki_holepunch_session_punch_hole(ChiakiHolepunchSession session, ChiakiHolepunchPortType port_type)
{
	(void)session;
	(void)port_type;
	return CHIAKI_ERR_UNKNOWN;
}

CHIAKI_EXPORT ChiakiRudp chiaki_rudp_init(chiaki_socket_t *sock, ChiakiLog *log)
{
	(void)sock;
	(void)log;
	return NULL;
}
CHIAKI_EXPORT ChiakiErrorCode chiaki_rudp_fini(ChiakiRudp rudp) { (void)rudp; return CHIAKI_ERR_SUCCESS; }
CHIAKI_EXPORT ChiakiErrorCode chiaki_rudp_ack_packet(ChiakiRudp rudp, uint16_t counter_to_ack) { (void)rudp; (void)counter_to_ack; return CHIAKI_ERR_UNKNOWN; }
CHIAKI_EXPORT void chiaki_rudp_print_message(ChiakiRudp rudp, RudpMessage *message) { (void)rudp; (void)message; }
CHIAKI_EXPORT void chiaki_rudp_message_pointers_free(RudpMessage *message) { (void)message; }
CHIAKI_EXPORT ChiakiErrorCode chiaki_rudp_recv_only(ChiakiRudp rudp, size_t buf_size, RudpMessage *message)
{
	(void)rudp;
	(void)buf_size;
	(void)message;
	return CHIAKI_ERR_UNKNOWN;
}
CHIAKI_EXPORT ChiakiErrorCode chiaki_rudp_send_ack_message(ChiakiRudp rudp, uint16_t remote_counter) { (void)rudp; (void)remote_counter; return CHIAKI_ERR_UNKNOWN; }
CHIAKI_EXPORT ChiakiErrorCode chiaki_rudp_send_ctrl_message(ChiakiRudp rudp, uint8_t *ctrl_message, size_t ctrl_message_size)
{
	(void)rudp;
	(void)ctrl_message;
	(void)ctrl_message_size;
	return CHIAKI_ERR_UNKNOWN;
}
CHIAKI_EXPORT ChiakiErrorCode chiaki_rudp_send_recv(ChiakiRudp rudp, RudpMessage *message, uint8_t *buf, size_t buf_size, uint16_t remote_counter,
	RudpPacketType send_type, RudpPacketType recv_type, size_t min_data_size, size_t tries)
{
	(void)rudp;
	(void)message;
	(void)buf;
	(void)buf_size;
	(void)remote_counter;
	(void)send_type;
	(void)recv_type;
	(void)min_data_size;
	(void)tries;
	return CHIAKI_ERR_UNKNOWN;
}
CHIAKI_EXPORT ChiakiErrorCode chiaki_rudp_send_switch_to_stream_connection_message(ChiakiRudp rudp) { (void)rudp; return CHIAKI_ERR_UNKNOWN; }
CHIAKI_EXPORT ChiakiErrorCode chiaki_rudp_stop_pipe_select_single(ChiakiRudp rudp, ChiakiStopPipe *stop_pipe, uint64_t timeout)
{
	(void)rudp;
	(void)stop_pipe;
	(void)timeout;
	return CHIAKI_ERR_UNKNOWN;
}

CHIAKI_EXPORT chiaki_socket_t *chiaki_get_holepunch_sock(ChiakiHolepunchSession session, ChiakiHolepunchPortType type)
{
	(void)session;
	(void)type;
	return NULL;
}
CHIAKI_EXPORT uint16_t chiaki_get_ps_ctrl_port(ChiakiHolepunchSession session) { (void)session; return 0; }
CHIAKI_EXPORT void chiaki_get_ps_selected_addr(ChiakiHolepunchSession session, char *ps_ip)
{
	(void)session;
	if(ps_ip)
		ps_ip[0] = '\0';
}
CHIAKI_EXPORT ChiakiHolepunchRegistInfo chiaki_get_regist_info(ChiakiHolepunchSession session)
{
	(void)session;
	ChiakiHolepunchRegistInfo info = {0};
	return info;
}
CHIAKI_EXPORT ChiakiErrorCode chiaki_rudp_send_raw(ChiakiRudp rudp, uint8_t *buf, size_t buf_size)
{
	(void)rudp;
	(void)buf;
	(void)buf_size;
	return CHIAKI_ERR_UNKNOWN;
}
CHIAKI_EXPORT ChiakiErrorCode holepunch_session_create_offer(ChiakiHolepunchSession session) { (void)session; return CHIAKI_ERR_UNKNOWN; }
