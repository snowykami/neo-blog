// 后台全局配置的注册表（后端 internal/config），表单按此生成；文案字段均为 Console.global 下的 i18n 键

export type ConfigType = 'string' | 'text' | 'secret' | 'url' | 'email' | 'image' | 'color' | 'int' | 'float' | 'bool' | 'enum' | 'string_list' | 'image_list' | 'link_list' | 'json'

export interface ConfigOption {
  value: string
  label?: string // 为空时直接显示 value
}

export interface ConfigItem {
  key: string // 配置键（snake_case），即表单字段名
  type: ConfigType
  label: string
  description?: string
  placeholder?: string // 原样显示
  placeholderKey?: string // 需要翻译的占位文本
  options?: ConfigOption[]
  min?: number
  max?: number
  step?: number
  rows?: number
  wide?: boolean
  widget?: string // 使用专用组件编辑
  showWhen?: { key: string, values: string[] }
  env?: string // 可覆盖它的环境变量
  envUnit?: string // 环境变量的单位与配置不同时注明，如 seconds
  default: unknown
  value: unknown // 数据库中的值（未保存过时为默认值）
  envValue?: string // 环境变量设置的值，此时以它为准，表单只读
  standalone: boolean // 存为同名独立配置键；否则只存在站点信息 site_info 中
}

export interface ConfigSection {
  tab: string
  key: string
  title: string
  description?: string
  widget?: string // 组内最前面、不对应配置项的组件
  items: ConfigItem[]
}

export interface ConfigSchema {
  tabs: { key: string, title: string }[]
  sections: ConfigSection[]
}
