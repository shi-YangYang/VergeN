package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/shi-YangYang/VergeN/server/internal/api"
	"github.com/shi-YangYang/VergeN/server/internal/auth"
	"github.com/shi-YangYang/VergeN/server/internal/store"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dbPath := flag.String("db", "vergen.db", "sqlite database path")
	addAdmin := flag.String("add-admin", "", `create an admin account "username:password", then exit`)
	downloads := flag.String("downloads", "", "directory of published client package files exposed on the root landing page")
	flag.Parse()

	s, err := store.Open(*dbPath)
	if err != nil {
		slog.Error("open database", "err", err)
		os.Exit(1)
	}
	defer s.Close()

	if *addAdmin != "" {
		username, password, ok := strings.Cut(*addAdmin, ":")
		if !ok || username == "" || len(password) < 8 {
			slog.Error("add-admin expects username:password with a password of at least 8 characters")
			os.Exit(1)
		}
		hash, err := auth.HashPassword(password)
		if err != nil {
			slog.Error("hash password", "err", err)
			os.Exit(1)
		}
		_, err = s.CreateUser(username, hash, "admin", time.Now())
		if errors.Is(err, store.ErrConflict) {
			slog.Error("username already exists", "username", username)
			os.Exit(1)
		}
		if err != nil {
			slog.Error("create admin", "err", err)
			os.Exit(1)
		}
		slog.Info("admin created", "username", username)
		return
	}

	sv, err := api.NewServer(s, *downloads)
	if err != nil {
		slog.Error("init server", "err", err)
		os.Exit(1)
	}

	handler, err := sv.Handler()
	if err != nil {
		slog.Error("build handler", "err", err)
		os.Exit(1)
	}
	httpSrv := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		slog.Info("vergen server listening", "addr", *addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("listen", "err", err)
			os.Exit(1)
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}
