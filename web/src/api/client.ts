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

axiosClient.interceptors.request.use((config) => {
  if (config.data && typeof config.data === 'object') {
    config.data = camelToSnakeObj(config.data)
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
