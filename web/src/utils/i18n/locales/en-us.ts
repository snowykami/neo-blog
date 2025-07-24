const resources = {
  translation: {
    name: "English",
    hello: "Hello",
    login: {
      login: "Login",
      failed: "Login failed",
      forgotPassword: "Forgot password?",
      username: "Username",
      usernameOrEmail: "Username or Email",
      password: "Password",
      remember: "Remember this device",
      captcha: {
        no: "No captcha required",
        failed: "Captcha verification failed, please try again",
        fetchFailed: "Failed to fetch captcha, please try again later",
        processing: "Waiting for verification...",
        reCaptchaProcessing: "Processing reCAPTCHA verification, please wait...",
        reCaptchaFailed: "reCAPTCHA verification failed, please try again",
        reCaptchaSuccess: "reCAPTCHA verification successful",
      },
      oidc: {
        fetchFailed: "Failed to fetch OIDC providers, please try again later",
        use: "Login with {{provider}}",
      },
    },
  },
};

export default resources;
