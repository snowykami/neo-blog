import axios from "axios";
import { camelToSnakeObj, snakeToCamelObj } from "field-conv";

const API_SUFFIX = "/api/v1";

const axiosInstance = axios.create({
  baseURL: API_SUFFIX,
  timeout: 10000,
});

axiosInstance.interceptors.request.use((config) => {
  if (config.data && typeof config.data === "object") {
    config.data = camelToSnakeObj(config.data);
  }
  if (config.params && typeof config.params === "object") {
    config.params = camelToSnakeObj(config.params);
  }
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => {
    if (response.data && typeof response.data === "object") {
      response.data = snakeToCamelObj(response.data);
    }
    return response;
  },
  (error) => Promise.reject(error),
);

export default axiosInstance;
