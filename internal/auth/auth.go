package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const tokenTTL = 24 * time.Hour

// GenerateToken creates a signed token: hex(random16)|expireUnix|HMAC(random16|expireUnix, secret)
func GenerateToken(secret string) (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("rand: %w", err)
	}
	nonce := hex.EncodeToString(buf)
	expire := strconv.FormatInt(time.Now().Add(tokenTTL).Unix(), 10)
	payload := nonce + "|" + expire
	mac := sign(payload, secret)
	return payload + "|" + mac, nil
}

// ValidateToken returns true if the token is well-formed, unmodified, and not expired.
func ValidateToken(token, secret string) bool {
	parts := strings.SplitN(token, "|", 3)
	if len(parts) != 3 {
		return false
	}
	nonce, expire, mac := parts[0], parts[1], parts[2]
	exp, err := strconv.ParseInt(expire, 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}

	payload := nonce + "|" + expire
	return hmac.Equal([]byte(sign(payload, secret)), []byte(mac))
}

func sign(payload, secret string) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(payload))
	return hex.EncodeToString(h.Sum(nil))
}
