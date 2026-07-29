#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "This launcher is intended for macOS." >&2
    exit 1
fi

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$script_directory/package.json" ]]; then
    project_root="$script_directory"
elif [[ "$(basename -- "$script_directory")" == "utils" && -f "$script_directory/../package.json" ]]; then
    project_root="$(cd -- "$script_directory/.." && pwd)"
else
    echo "Could not find the project root. Run this script from utils/ or copy it to the repository root." >&2
    exit 1
fi

state_directory="$project_root/.tmp-local-server"
state_file="$state_directory/processes"
project_ports=(4000 4100 10666 10667)
runtime="npm"
kill_requested=false

usage() {
    cat <<'EOF'
Usage: dev-local-macos.sh [--runtime npm|docker] [--kill]

  --runtime npm      Start both npm development applications (default).
  --runtime docker   Start both services with Docker Compose.
  --kill             Stop tracked npm servers and the Docker Compose services.
EOF
}

while (($# > 0)); do
    case "$1" in
        --runtime)
            if (($# < 2)); then
                echo "--runtime requires npm or docker." >&2
                exit 2
            fi
            runtime="$2"
            shift 2
            ;;
        --runtime=*)
            runtime="${1#*=}"
            shift
            ;;
        --kill)
            kill_requested=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

if [[ "$runtime" != "npm" && "$runtime" != "docker" ]]; then
    echo "Runtime must be npm or docker." >&2
    exit 2
fi

stop_process_tree() {
    local process_id="$1"
    local child_ids

    if ! kill -0 "$process_id" 2>/dev/null; then
        return
    fi

    child_ids="$(pgrep -P "$process_id" 2>/dev/null || true)"
    for child_id in $child_ids; do
        stop_process_tree "$child_id"
    done

    kill "$process_id" 2>/dev/null || true
}

stop_npm_servers() {
    local process_ids=()
    local process_id
    local process_command

    if [[ -f "$state_file" ]]; then
        while IFS='|' read -r process_id _; do
            [[ "$process_id" =~ ^[0-9]+$ ]] && process_ids+=("$process_id")
        done < "$state_file"
    fi

    if command -v lsof >/dev/null 2>&1; then
        for port in "${project_ports[@]}"; do
            while IFS= read -r process_id; do
                [[ "$process_id" =~ ^[0-9]+$ ]] || continue
                process_command="$(ps -p "$process_id" -o command= 2>/dev/null || true)"
                if [[ "$process_command" == *"$project_root"* ]]; then
                    process_ids+=("$process_id")
                fi
            done < <(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
        done
    fi

    if ((${#process_ids[@]} == 0)); then
        echo "No local npm web servers were found."
    else
        for process_id in "${process_ids[@]}"; do
            stop_process_tree "$process_id"
        done
        echo "Stopped local npm web servers."
    fi

    rm -f -- "$state_file"
}

stop_docker_services() {
    if ! command -v docker >/dev/null 2>&1; then
        echo "Warning: Docker is not installed or is not on PATH; no containers were stopped." >&2
        return
    fi

    docker compose -f "$project_root/docker-compose.yml" stop
}

start_npm_servers() {
    local saved_process_id

    if [[ -f "$state_file" ]]; then
        while IFS='|' read -r saved_process_id _; do
            if [[ "$saved_process_id" =~ ^[0-9]+$ ]] && kill -0 "$saved_process_id" 2>/dev/null; then
                echo "Local npm servers are already running. Use --kill first." >&2
                exit 1
            fi
        done < "$state_file"
    fi

    command -v npm >/dev/null 2>&1 || {
        echo "npm is not installed or is not on PATH." >&2
        exit 1
    }

    mkdir -p -- "$state_directory"
    cd -- "$project_root"

    npm run dev >>"$state_directory/game.log" 2>&1 &
    game_pid=$!
    npm run dev:tables >>"$state_directory/tables.log" 2>&1 &
    tables_pid=$!

    printf '%s|game\n%s|tables\n' "$game_pid" "$tables_pid" > "$state_file"

    echo "Started the npm development servers."
    echo "Game:   http://localhost:10666"
    echo "Tables: http://localhost:10667"
    echo "Logs:   $state_directory"
}

start_docker_services() {
    command -v docker >/dev/null 2>&1 || {
        echo "Docker is not installed or is not on PATH." >&2
        exit 1
    }

    docker compose -f "$project_root/docker-compose.yml" up -d
    echo "Started the Docker Compose services."
    echo "Game:   http://localhost:4000"
    echo "Tables: http://localhost:4100"
}

if [[ "$kill_requested" == true ]]; then
    stop_npm_servers
    stop_docker_services
elif [[ "$runtime" == "docker" ]]; then
    start_docker_services
else
    start_npm_servers
fi
