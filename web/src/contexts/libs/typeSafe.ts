/**
 * 因为这里不得不使用 any 但是为了 any 是避免的，此时就需要进行解决
 * 这里的解决方法是：
 * 1. 先将 obj 转换为 unknown 类型
 * 2. 再将 unknown 类型转换为 Record<K, V> 类型
 * 3. 最后进行赋值
 * 
 * **tips: 这里只是解决了编译器的类型检查问题，但是还是不安全的讷，后面还需要进行调整**
 * **核心：直接对着看 use-enhance-context.ts 是否有报错没有把，没有的话那就说明这里对了以及安全了，首先保证编译不报错吧**
 */

export function setPropertySafely<
  T extends object,
  K extends keyof T,
  V
>(
  obj: T, 
  key: K, 
  value: V
): void {
  const temp: unknown = obj;
  (temp as Record<K, V>)[key] = value;
}

export function getPropertySafely<
  T extends object,
  K extends keyof T
>(obj: T, key: K): T[K] {
  const temp: unknown = obj;
  return (temp as Record<K, T[K]>)[key];
}

export function deletePropertySafely<
  T extends object,
  K extends keyof T
>(obj: T, key: K): void {
  const temp: unknown = obj;
  delete (temp as Record<K, unknown>)[key];
}

export const memoizedStore = {
  set: setPropertySafely,
  get: getPropertySafely,
  delete: deletePropertySafely,
};