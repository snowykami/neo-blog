package model

import "testing"

// 公开接口用的用户列表不能带邮箱等隐私字段；后台列表带邮箱
func TestUserDtoListsPrivacy(t *testing.T) {
	users := []User{{Username: "alice", Email: "alice@example.com"}, {Username: "bob", Email: "bob@example.com"}}

	for _, u := range ToPublicUserDtos(users) {
		if u.Email != "" || u.CreatedAt != nil || u.Disabled != nil || u.IsAI != nil {
			t.Fatalf("public user dto leaks private fields: %+v", u)
		}
		if u.GravatarHash == "" {
			t.Fatalf("public user dto should keep gravatar hash for avatars: %+v", u)
		}
	}
	for i, u := range ToAdminUserDtos(users) {
		if u.Email != users[i].Email {
			t.Fatalf("admin user dto should include email, got %q", u.Email)
		}
	}
}
