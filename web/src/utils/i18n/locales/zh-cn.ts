const resources = {
  translation: {
    name: "中文",
    hello: "你好",
    login: {
      login: "登录",
      failed: "登录失败",
      forgotPassword: "忘了密码？",
      username: "用户名",
      usernameOrEmail: "用户名或邮箱",
      password: "密码",
      remember: "记住这个设备",
      captcha: {
        no: "无需进行机器人挑战",
        failed: "机器人挑战失败，请重试",
        fetchFailed: "获取验证码失败，请稍后再试",
        processing: "等待验证...",
        reCaptchaProcessing: "正在处理 reCAPTCHA 验证，请稍候...",
        reCaptchaFailed: "reCAPTCHA 验证失败，请重试",
        reCaptchaSuccess: "reCAPTCHA 验证成功",
      },
      oidc: {
        fetchFailed: "获取 OIDC 提供商失败，请稍后再试",
        use: "使用 {{provider}} 登录",
      },
    },
  },
};

export default resources;
