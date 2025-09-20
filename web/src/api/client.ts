import axios from 'axios'
import { camelToSnakeObj, snakeToCamelObj } from 'field-conv'

export const BACKEND_URL = process.env.BACKEND_URL || (process.env.NODE_ENV == "production" ? 'http://neo-blog-backend:8888' : 'http://localhost:8888')

console.info(`Using ${process.env.NODE_ENV} backend URL: ${BACKEND_URL}`)

const isServer = typeof window === 'undefined'

const API_SUFFIX = '/api/v1'

const axiosClient = axios.create({
  baseURL: isServer ? BACKEND_URL + API_SUFFIX : API_SUFFIX,
  timeout: 10000,
})

function isBrowserFormData(v: any) {
  return typeof FormData !== 'undefined' && v instanceof FormData
}
// node form-data (form-data package) heuristic
function isNodeFormData(v: any) {
  return v && typeof v.getHeaders === 'function' && typeof v.pipe === 'function'
}

axiosClient.interceptors.request.use((config) => {
  // 如果是 FormData（浏览器）或 node form-data，跳过对象转换
  if (config.data && typeof config.data === 'object' && !isBrowserFormData(config.data) && !isNodeFormData(config.data)) {
    config.data = camelToSnakeObj(config.data)
  } else if (isBrowserFormData(config.data)) {
    // 只处理键
    const formData = config.data as FormData
    const newFormData = new FormData()
    for (const [key, value] of formData.entries()) {
      newFormData.append(camelToSnakeObj(key), value)
    }
    config.data = newFormData
  }
  if (config.params && typeof config.params === 'object') {
    config.params = camelToSnakeObj(config.params)
  }
  return config
})

axiosClient.interceptors.response.use(
  (response) => {
    if (response.data && typeof response.data === 'object') {
      response.data = snakeToCamelObj(response.data)
    }
    return response
  },
  error => Promise.reject(error),
)

export default axiosClient
