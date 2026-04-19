BUN := /home/user/.bun/bin/bun
PIDFILE := .agent.pid

# Force bash (not /bin/sh) — `disown`, process substitution, and `[[
# ... ]]` rely on bash semantics.
SHELL := /bin/bash

.PHONY: start start-detached stop restart status logs nudge help

help:
	@echo "eliza-gemma operations"
	@echo ""
	@echo "  make start          Launch eliza in the current terminal's cgroup"
	@echo "                      (convenient but inherits the caller's slice —"
	@echo "                       on a Claude Code terminal, that's claude.slice)"
	@echo "  make start-detached Launch eliza in its own systemd transient scope"
	@echo "                      under user.slice. Use this when starting from a"
	@echo "                      Claude Code terminal so Eliza doesn't share the"
	@echo "                      claude.slice memory cap."
	@echo "  make stop           Stop via SIGTERM, escalate to SIGKILL after 2s"
	@echo "  make restart        stop + start"
	@echo "  make status         Show the running pid + command, or 'not running'"
	@echo "  make logs           tail -f agent.log"
	@echo "  make nudge          Send SIGUSR1 to trigger one engagement-client"
	@echo "                      tick immediately (v0.23+ of plugin-colony)"

start:
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "already running (pid $$(cat $(PIDFILE)))"; \
		exit 1; \
	fi
	@rm -f $(PIDFILE)
	@nohup $(BUN) run start > agent.log 2>&1 & echo $$! > $(PIDFILE); disown
	@sleep 8
	@if kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "started (pid $$(cat $(PIDFILE)))"; \
		tail -5 agent.log; \
	else \
		echo "failed to start — see agent.log"; \
		tail -20 agent.log; \
		rm -f $(PIDFILE); \
		exit 1; \
	fi

# Launch under a transient systemd scope in user.slice. Needed when the
# operator's terminal is inside claude.slice (or any other capped slice)
# — without this, eliza inherits the caller's cap. Background incident:
# 2026-04-18, a test:coverage run inside a Claude Code terminal brushed
# claude.slice's MemoryHigh=8G soft cap and systemd-oomd killed the
# whole scope. Eliza was co-located and went down with it.
#
# Falls back to plain `make start` when systemd-run isn't available.
start-detached:
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "already running (pid $$(cat $(PIDFILE)))"; \
		exit 1; \
	fi
	@if ! command -v systemd-run >/dev/null 2>&1; then \
		echo "systemd-run not available — falling back to plain make start"; \
		$(MAKE) start; \
		exit 0; \
	fi
	@rm -f $(PIDFILE)
	@systemd-run --user --slice=user.slice --unit=eliza-gemma-$$$$ \
		--quiet --collect \
		--property=WorkingDirectory=$(CURDIR) \
		--property=StandardOutput=append:$(CURDIR)/agent.log \
		--property=StandardError=append:$(CURDIR)/agent.log \
		$(BUN) run start
	@sleep 8
	@systemctl --user status --no-pager --lines=0 "eliza-gemma-*" 2>/dev/null | head -3 || true
	@PID=$$(systemctl --user show -p MainPID --value "eliza-gemma-*.service" 2>/dev/null | head -1); \
		if [ -n "$$PID" ] && [ "$$PID" != "0" ]; then \
			echo "$$PID" > $(PIDFILE); \
			echo "started under user.slice (pid $$PID)"; \
			tail -5 agent.log; \
		else \
			echo "failed to start — see agent.log"; \
			tail -20 agent.log; \
			exit 1; \
		fi

stop:
	@if [ ! -f $(PIDFILE) ] || ! kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "not running"; \
		rm -f $(PIDFILE); \
		exit 0; \
	fi
	@PID=$$(cat $(PIDFILE)); \
		pkill -TERM -P $$PID 2>/dev/null || true; \
		kill -TERM $$PID 2>/dev/null || true; \
		sleep 2; \
		if kill -0 $$PID 2>/dev/null; then \
			echo "still alive after SIGTERM — sending SIGKILL"; \
			pkill -9 -P $$PID 2>/dev/null || true; \
			kill -9 $$PID 2>/dev/null || true; \
			sleep 1; \
		fi; \
		rm -f $(PIDFILE); \
		echo "stopped"

restart: stop start

status:
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "running (pid $$(cat $(PIDFILE)))"; \
		ps -o pid,cmd -p $$(cat $(PIDFILE)); \
	else \
		echo "not running"; \
	fi

logs:
	@tail -f agent.log

# Trigger one engagement-client tick immediately. Requires
# `@thecolony/elizaos-plugin` ^0.23.0 on the running agent AND
# `COLONY_REGISTER_SIGNAL_HANDLERS=true` in .env.
# Use when you know there's something worth engaging with and don't
# want to wait for the next auto-tick (300-900s by default).
nudge:
	@if [ ! -f $(PIDFILE) ] || ! kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "not running — nothing to nudge"; \
		exit 1; \
	fi
	@PID=$$(cat $(PIDFILE)); \
		kill -USR1 $$PID && echo "sent SIGUSR1 to pid $$PID (engagement tick should fire immediately)" \
		|| { echo "kill -USR1 failed"; exit 1; }
