// 性别的标准取值，与后端 internal/model/user.go 一致；其余非空内容为用户自定义的文字，空表示不填
export const GENDER_MALE = 'male'
export const GENDER_FEMALE = 'female'
// 自定义性别的最大字数，与后端 internal/service/admin_user.go 的 genderMaxLen 一致
export const GENDER_CUSTOM_MAX = 20

export type StandardGender = typeof GENDER_MALE | typeof GENDER_FEMALE

// 只认小写的标准值，其余写法（如 Male）按自定义文字处理，与后端一致
export function isStandardGender(value: string): value is StandardGender {
  return value === GENDER_MALE || value === GENDER_FEMALE
}

// 按字符（码点）计数，与后端 utf8.RuneCountInString 一致
export function isValidGender(value: string) {
  return Array.from(value.trim()).length <= GENDER_CUSTOM_MAX
}
