package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"time"
)

type iosPoolRequest struct {
	Action   string `json:"action"`
	ID       int64  `json:"id,omitempty"`
	Owner    string `json:"owner,omitempty"`
	Employee string `json:"employee,omitempty"`
	Text     string `json:"text,omitempty"`
}

type iosPoolReply struct {
	Items []struct {
		ID             int64  `json:"id"`
		Status         string `json:"status"`
		Employee       string `json:"employee"`
		AssignedAt     int64  `json:"assigned_at"`
		AddressPreview string `json:"address_preview"`
	} `json:"items,omitempty"`
	Added   int    `json:"added,omitempty"`
	Skipped int    `json:"skipped,omitempty"`
	Line    int    `json:"line,omitempty"`
	URL     string `json:"url,omitempty"`
	Error   string `json:"error,omitempty"`
}

func runIOSPool(ctx context.Context, req iosPoolRequest) (iosPoolReply, error) {
	var reply iosPoolReply
	config := os.Getenv("VERGEN_IOS_SSH_CONFIG")
	if config == "" {
		config = "/etc/vergen/ios-ssh.conf"
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "-o", "StrictHostKeyChecking=yes", "-F", config, "vergen-ios")
	body, err := json.Marshal(req)
	if err != nil {
		return reply, err
	}
	cmd.Stdin = bytes.NewReader(body)
	out, err := cmd.Output()
	if err != nil {
		return reply, err
	}
	err = json.Unmarshal(out, &reply)
	return reply, err
}

func (a *Server) handleIOSPool(w http.ResponseWriter, r *http.Request) {
	req := iosPoolRequest{Action: "list"}
	if r.PathValue("id") != "" {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil || id < 1 {
			fail(w, 400, "invalid_id", "无效的订阅编号")
			return
		}
		req.Action, req.ID = "address", id
		if r.Method == http.MethodDelete {
			req.Action = "revoke"
		}
	}
	reply, ok := a.iosPoolResponse(w, r, req)
	if !ok {
		return
	}
	if req.Action == "address" {
		if !validateSubscriptionURL(reply.URL) {
			fail(w, http.StatusBadGateway, "invalid_pool_response", "无法读取该订阅地址")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"url": reply.URL})
		return
	}
	if req.Action == "list" {
		writeJSON(w, 200, map[string]any{"items": reply.Items})
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

func (a *Server) handleIOSImport(w http.ResponseWriter, r *http.Request) {
	payload, ok := readJSON[struct {
		Text string `json:"text"`
	}](w, r)
	if !ok {
		return
	}
	if len(payload.Text) > 256*1024 {
		fail(w, http.StatusRequestEntityTooLarge, "import_size", "每次可导入最多 1000 条地址，文件最大 256 KiB")
		return
	}
	reply, ok := a.iosPoolResponse(w, r, iosPoolRequest{Action: "import", Text: payload.Text})
	if ok {
		writeJSON(w, http.StatusOK, map[string]int{"added": reply.Added, "skipped": reply.Skipped})
	}
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
	reply, ok := a.iosPoolResponse(w, r, iosPoolRequest{Action: "claim", Owner: hex.EncodeToString(owner[:]), Employee: name})
	if !ok {
		return
	}
	if !validateSubscriptionURL(reply.URL) {
		fail(w, 502, "invalid_pool_response", "家宽节点返回的订阅地址无效")
		return
	}
	writeJSON(w, 200, map[string]string{"url": reply.URL})
}

func (a *Server) iosPoolResponse(w http.ResponseWriter, r *http.Request, req iosPoolRequest) (iosPoolReply, bool) {
	w.Header().Set("Cache-Control", "private, no-store")
	reply, err := a.iosPool(r.Context(), req)
	switch {
	case errors.Is(err, context.Canceled):
		return reply, false
	case err != nil:
		fail(w, 503, "ios_pool_unavailable", "暂时无法连接家宽订阅服务，请重试")
	case reply.Error == "revoked":
		fail(w, 403, "ios_revoked", "你的 iOS 订阅已撤销，请联系管理员")
	case reply.Error == "empty":
		fail(w, 409, "ios_pool_empty", "可用订阅已领完，请联系管理员补充")
	case reply.Error == "missing":
		fail(w, 404, "ios_missing", "订阅不存在")
	case reply.Error == "invalid_address":
		fail(w, http.StatusBadRequest, "invalid_address", "第 "+strconv.Itoa(reply.Line)+" 行的地址无效，请使用家宽节点的完整个人订阅链接")
	case reply.Error == "empty_import":
		fail(w, http.StatusBadRequest, "empty_import", "请至少填写一条订阅地址")
	case reply.Error == "import_size":
		fail(w, http.StatusRequestEntityTooLarge, "import_size", "每次可导入最多 1000 条地址，文件最大 256 KiB")
	case reply.Error != "":
		fail(w, 502, "invalid_pool_response", "家宽订阅服务返回错误")
	default:
		return reply, true
	}
	return reply, false
}
