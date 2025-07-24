import { initReactI18next } from "react-i18next";

import i18n from "i18next";

import resources from "./locales";

export const getDefaultLang = () => {
  if (typeof window !== "undefined") {
    return (
      localStorage.getItem("language") ||
      navigator.language.replace("_", "-") || // 保证格式
      "zh-CN"
    );
  }
  return "zh-CN";
};

i18n.use(initReactI18next).init({
  resources: resources,
  lng: getDefaultLang(),
  fallbackLng: "zh-CN",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
