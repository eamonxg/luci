#!/usr/bin/env bash

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ssh_host="root@192.168.1.1"
dry_run=0
sync_all=0
no_restart=0

usage() {
	cat <<'USAGE'
Usage: scripts/sync.sh [options]

Sync luci-mod-dashboard runtime files to an OpenWrt router via SCP.
Syncs only git-changed files by default; use --all to push everything.

  htdocs/* -> /www/*
  root/*   -> /*

After syncing, clears the LuCI cache and restarts uhttpd so changes
take effect immediately in the browser.

Options:
  --host USER@HOST  Target router (default: root@192.168.1.1)
  --all             Sync all runtime files, not just git changes
  --no-restart      Skip uhttpd restart after sync
  --dry-run         Print actions without copying files or restarting
  -h, --help        Show this help

Examples:
  scripts/sync.sh
  scripts/sync.sh --all
  scripts/sync.sh --host root@192.168.1.1 --dry-run
USAGE
}

log()  { printf '[dashboard-sync] %s\n' "$*"; }
die()  { printf '[dashboard-sync] ERROR: %s\n' "$*" >&2; exit 1; }

require_cmd() {
	command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

remote_path_for() {
	case "$1" in
	htdocs/*) printf '/www/%s\n' "${1#htdocs/}" ;;
	root/*)   printf '/%s\n'    "${1#root/}"    ;;
	*)        return 1 ;;
	esac
}

parse_args() {
	while [ "$#" -gt 0 ]; do
		case "$1" in
		--host)
			[ "$#" -ge 2 ] || die "--host requires a value"
			ssh_host="$2"; shift 2 ;;
		--all)
			sync_all=1; shift ;;
		--no-restart)
			no_restart=1; shift ;;
		--dry-run)
			dry_run=1; shift ;;
		-h|--help)
			usage; exit 0 ;;
		*)
			die "Unknown option: $1" ;;
		esac
	done
}

collect_changed_files() {
	if [ "$sync_all" -eq 1 ]; then
		find htdocs root -type f 2>/dev/null | sort
		return
	fi

	# Files changed relative to master (staged, unstaged, or untracked)
	{
		# Against the base branch (all commits on this branch)
		git diff --name-only master...HEAD -- htdocs root 2>/dev/null || true
		# Plus any local uncommitted changes
		git status --porcelain=v1 -- htdocs root | while IFS= read -r line; do
			[ -n "$line" ] || continue
			status="${line:0:2}"
			path="${line:3}"
			case "$status" in
			R*|C*) path="${path##* -> }" ;;
			esac
			if [ -d "$path" ]; then
				find "$path" -type f
			else
				printf '%s\n' "$path"
			fi
		done
	} | sort -u
}

run_ssh() {
	if [ "$dry_run" -eq 1 ]; then
		printf 'ssh %s %s\n' "$ssh_host" "$*"
	else
		ssh "$ssh_host" "$@"
	fi
}

run_scp() {
	local src="$1" dst="$2"
	if [ "$dry_run" -eq 1 ]; then
		printf 'scp %s %s:%s\n' "$src" "$ssh_host" "$dst"
	else
		scp "$src" "$ssh_host:$dst"
	fi
}

sync_file() {
	local path="$1" remote_path remote_dir

	remote_path="$(remote_path_for "$path")" || {
		log "Skipping non-runtime path: $path"
		return
	}

	if [ ! -e "$path" ]; then
		log "Removing $remote_path"
		run_ssh "rm -f '$remote_path'"
		return
	fi

	remote_dir="$(dirname "$remote_path")"
	log "  $path -> $remote_path"
	run_ssh "mkdir -p '$remote_dir'"
	run_scp "$path" "$remote_path"
}

main() {
	parse_args "$@"
	require_cmd git
	require_cmd ssh
	require_cmd scp

	cd "$MODULE_DIR"

	files=()
	while IFS= read -r file; do
		[ -n "$file" ] && files+=("$file")
	done < <(collect_changed_files)

	if [ "${#files[@]}" -eq 0 ]; then
		log "No changed runtime files to sync."
		log "Tip: use --all to sync everything, or make some edits first."
		exit 0
	fi

	log "Target: $ssh_host"
	log "Files: ${#files[@]}"
	for file in "${files[@]}"; do
		sync_file "$file"
	done

	if [ "$no_restart" -eq 0 ]; then
		log "Clearing LuCI cache and restarting uhttpd..."
		run_ssh "rm -rf /tmp/luci-* 2>/dev/null; /etc/init.d/uhttpd restart"
	fi

	log "Done. Hard-refresh your browser (Cmd+Shift+R) to see changes."
}

main "$@"
