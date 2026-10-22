#!/usr/bin/env bash
#
# Turn this machine's internet egress off, keeping the LAN alive.
#
#   sudo lan-only.sh off      # internet off, LAN and DNS still work
#   sudo lan-only.sh on       # internet back
#   lan-only.sh status        # what is in effect right now
#
# Why a route blackhole instead of firewall rules: it adds one extra default
# route with a better priority, so anything not on a local network fails
# immediately with "Network is unreachable". It holds no state, cannot
# contradict ufw/docker/nftables rules, and is undone by deleting one route —
# which matters when the only way back in is the machine you just locked down.
#
# It is not a substitute for a real firewall: it cannot distinguish programs or
# ports, and it covers only the main routing table. Use it as the everyday
# switch, and keep a firewall behind it if you need policy that survives a
# program that brings its own route.
#
# DNS still reaches the router, because the router is on the local network.
# Domain names therefore still leave the machine; the resolved address simply
# cannot be connected to.

set -euo pipefail

PRIO=1 # lower than a DHCP metric, so it is matched before the real default route

add_blackhole() {
	ip add blackhole default prio "$PRIO" 2>/dev/null || true
	ip -6 add blackhole default prio "$PRIO" 2>/dev/null || true
}

del_blackhole() {
	ip del blackhole default prio "$PRIO" 2>/dev/null || true
	ip -6 del blackhole default prio "$PRIO" 2>/dev/null || true
}

has_blackhole() {
	ip route show exact default prio "$PRIO" 2>/dev/null | grep -q blackhole
}

status() {
	if has_blackhole; then
		echo "internet: OFF (blackhole default prio $PRIO is installed)"
	else
		echo "internet: ON (no blackhole route)"
	fi
	ip route show | grep -E '^(blackhole )?default' | sed 's/^/  v4 /' || true
	ip -6 route show | grep -E '^(blackhole )?default' | sed 's/^/  v6 /' || true
}

case "${1:-status}" in
off)
	[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo $0 off" >&2; exit 1; }
	add_blackhole
	echo "Internet egress is blocked; local networks and the router still respond."
	echo "Undo with: sudo $0 on"
	;;
on)
	[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo $0 on" >&2; exit 1; }
	del_blackhole
	echo "Internet egress restored."
	;;
status)
	status
	;;
*)
	echo "usage: $0 {off|on|status}" >&2
	exit 2
	;;
esac
