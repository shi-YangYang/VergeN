package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/shi-YangYang/VergeN/server/internal/store"
)

func (a *Server) handleIOSPool(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	if r.PathValue("id") == "" {
		items, err := a.store.ListIOSSubscriptions(r.Context())
		if err != nil {
			iosStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		fail(w, 400, "invalid_id", "无效的订阅编号")
		return
	}
	if r.Method == http.MethodDelete {
		if err := a.store.RevokeIOSSubscription(r.Context(), id); err != nil {
			iosStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct{}{})
		return
	}
	address, err := a.store.IOSSubscriptionURL(r.Context(), id)
	if err != nil {
		iosStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": address})
}

func (a *Server) handleIOSImport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	payload, ok := readJSON[struct {
		Text string `json:"text"`
	}](w, r)
	if !ok {
		return
	}
	added, skipped, err := a.store.ImportIOSSubscriptions(r.Context(), payload.Text)
	if err != nil {
		iosStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"added": added, "skipped": skipped})
}

func (a *Server) handleIOSClaim(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	user := a.downloadUser(r)
	if user == nil {
		fail(w, 401, "download_login_required", "请使用公司钉钉登录")
		return
	}
	// SameSite cookies and the required JSON content type exclude cross-site form submissions.
	if r.Header.Get("Content-Type") != "application/json" {
		fail(w, 415, "invalid_content_type", "需要 JSON 请求")
		return
	}
	owner := sha256.Sum256([]byte(user.DingTalkUserID))
	name := user.DisplayName
	if name == "" {
		name = user.Username
	}
	address, err := a.store.ClaimIOSSubscription(r.Context(), hex.EncodeToString(owner[:]), name, time.Now().Unix())
	if err != nil {
		iosStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": address})
}

func iosStoreError(w http.ResponseWriter, err error) {
	var invalid *store.InvalidIOSLink
	switch {
	case errors.As(err, &invalid):
		fail(w, 400, "invalid_address", "第 "+strconv.Itoa(invalid.Line)+" 行地址无效，请使用同一家宽订阅站点的完整个人链接")
	case errors.Is(err, store.ErrIOSImportSize):
		fail(w, 413, "import_size", "每次可导入最多 1000 条地址，文件最大 256 KiB")
	case errors.Is(err, store.ErrIOSImportEmpty):
		fail(w, 400, "empty_import", "请至少填写一条订阅地址")
	case errors.Is(err, store.ErrNotFound):
		fail(w, 404, "ios_missing", "订阅不存在")
	case errors.Is(err, store.ErrIOSRevoked):
		fail(w, 403, "ios_revoked", "你的 iOS 订阅领取资格已撤销，请联系管理员")
	case errors.Is(err, store.ErrIOSPoolEmpty):
		fail(w, 409, "ios_pool_empty", "暂无可领取的订阅地址，请联系管理员补充")
	default:
		fail(w, 500, "internal_error", "无法读写运维数据库，请重试")
	}
}
