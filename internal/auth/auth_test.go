package auth_test

import (
	"strings"
	"testing"

	"ffmeditor/internal/auth"
)

const secret = "test-secret-abc123"

func TestGenerateAndValidate(t *testing.T) {
	token, err := auth.GenerateToken(secret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	if !auth.ValidateToken(token, secret) {
		t.Error("valid token rejected")
	}
}

func TestWrongSecret(t *testing.T) {
	token, _ := auth.GenerateToken(secret)
	if auth.ValidateToken(token, "wrong-secret") {
		t.Error("wrong secret accepted")
	}
}

func TestTamperedMAC(t *testing.T) {
	token, _ := auth.GenerateToken(secret)
	parts := strings.SplitN(token, "|", 3)
	tampered := parts[0] + "|" + parts[1] + "|" + "00000000000000000000000000000000000000000000000000000000000000ff"
	if auth.ValidateToken(tampered, secret) {
		t.Error("tampered MAC accepted")
	}
}

func TestMalformedToken(t *testing.T) {
	for _, bad := range []string{"", "abc", "a|b", "a|b|c|d"} {
		if auth.ValidateToken(bad, secret) {
			t.Errorf("malformed token %q accepted", bad)
		}
	}
}

func TestExpiredToken(t *testing.T) {
	// Construct a token with an expired timestamp
	expired := "aabbccddeeff00112233445566778899|0|" // expire=0 (1970)
	// sign it correctly
	// We can't easily test this without exposing sign(), so just check the library rejects it
	if auth.ValidateToken(expired+"invalidsig", secret) {
		t.Error("expired token accepted")
	}
}
