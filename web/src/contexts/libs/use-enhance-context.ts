"use client"

import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import type {
  ComponentType,
  ReactNode,
  DependencyList,
  ProviderProps,
} from 'react';
import { memoizedStore } from './typeSafe';

type ConfigurableContextHook<T, P = {}> = {
  Context: React.Context<T | undefined>;
  useHook: () => T;
  Provider: ComponentType<P & { children: ReactNode }>;
};

type ConfigurableContextHookFnType = <T, P = {}>(
  displayName: string,
  useValue?: (props: P) => T,
) => ConfigurableContextHook<T, P>;

// 提取函数属性名
type FunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends (...args: readonly unknown[]) => unknown ? K : never;
}[keyof T];

// 提取非函数属性名
type NonFunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends (...args: readonly unknown[]) => unknown ? never : K;
}[keyof T];

// 记忆化函数的存储结构类型
interface MemoizedFunction<Args extends readonly unknown[], Return> {
  readonly fn: (...args: Args) => Return;
  readonly deps: DependencyList;
}

const isObject = <T>(value: T): value is T & object => {
  return typeof value === 'object' && value !== null;
};

const isFunction = <T>(value: T): value is T & ((...args: unknown[]) => unknown) => {
  return typeof value === 'function';
};

const shallowEqual = <T>(a: T, b: T): boolean => {
  if (a === b) {
    return true;
  }
  if (!isObject(a) || !isObject(b)) {
    return false;
  }
  const keysA = Object.keys(a) as (keyof T)[];
  const keysB = Object.keys(b) as (keyof T)[];
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || a[key] !== b[key]) {
      return false;
    }
  }
  return true;
};

const createConfigurableContextHook: ConfigurableContextHookFnType = <T, P = {}>(
  displayName: string,
  useValue?: (props: P) => T,
): ConfigurableContextHook<T, P> => {
  const Context = createContext<T | undefined>(undefined);
  Context.displayName = displayName;

  const useHook = () => {
    const context = useContext(Context);
    // console.log(context)
    if (context === undefined) {
      throw new Error(`${displayName} must be used within a ${displayName}Provider`);
    }
    return context;
  };

  // 如果有 useValue，创建自定义 Provider
  if (useValue) {
    const Provider: ComponentType<P & { children: ReactNode }> = ({ children, ...props }) => {
      const rawValue = useValue(props as P);
      
      const memoizedFunctions = useRef<{
        [K in keyof T]?: T[K] extends (...args: readonly unknown[]) => unknown 
          ? MemoizedFunction<
              Parameters<Extract<T[K], (...args: readonly unknown[]) => unknown>>,
              ReturnType<Extract<T[K], (...args: readonly unknown[]) => unknown>>
            >
          : never;
      }>({});

      // 收集非函数属性作为依赖
      const dependencies: DependencyList & Array<unknown> = [];
      if (isObject(rawValue)) {
        const nonFunctionKeys = Object.keys(rawValue) as Array<keyof T>;
        nonFunctionKeys.forEach(key => {
          if (!isFunction(rawValue[key])) {
            dependencies.push(rawValue[key]);
          }
        });
      }

      // useMemo 进行包裹计算结果，实现对于计算结果的缓存吧
      const functionCache = useMemo(() => {
        const cache: Record<string, any> = {};
        if (isObject(rawValue)) {
          Object.entries(rawValue).forEach(([key, value]) => {
            if (isFunction(value)) {
              cache[key] = (...args: any[]) => (value as Function)(...args);
            }
          });
        }
        return cache;
      }, [rawValue, ...dependencies]);

      // const setMemoizedFunction = <K extends keyof T>(
      //   store: typeof memoizedFunctions.current,
      //   key: K,
      //   value: {
      //     fn: T[K];
      //     deps: DependencyList;
      //   }
      // ) => {
      //   (store as unknown as Record<K, typeof value>)[key] = value;
      // };

      const getMemoizedFunction = useCallback(<K extends keyof T>(
        key: K,
        fn: T[K],
        deps: DependencyList
      ): T[K] => {
        const current = memoizedFunctions.current[key];
        if (!current || !shallowEqual(current.deps, deps)) {
          const memoizedFn = functionCache[key as string] as T[K];
          if (memoizedFn) {
            memoizedStore.set(memoizedFunctions.current, key, {
              fn: memoizedFn,
              deps: [...deps],
            });
            return memoizedFn;
          }
          return fn;
        }
        return current.fn as T[K];
      }, [functionCache]);

      // 缓存最终 value
      const memoizedValue = useMemo(() => {
        if (!isObject(rawValue)) {
          return rawValue;
        }
        const result = {} as T;
        Object.entries(rawValue).forEach(([key, value]) => {
          const typedKey = key as keyof T;
          if (isFunction(value)) {
            result[typedKey] = getMemoizedFunction(typedKey, value, dependencies);
          } else {
            result[typedKey] = value;
          }
        });
        return result;
      }, [rawValue, getMemoizedFunction, ...dependencies]);

      return React.createElement(
        Context.Provider,
        { value: memoizedValue },
        children
      );
    };

    return {
      Context,
      useHook,
      Provider,
    };
  } else {
    const Provider: ComponentType<ProviderProps<T | undefined> & P> = (props) => 
      React.createElement(Context.Provider, props);
    return {
      Context,
      useHook,
      Provider: Provider as ComponentType<P & { children: ReactNode }>,
    };
  }
};

export default createConfigurableContextHook;
export {
  type ConfigurableContextHook,
  type ConfigurableContextHookFnType,
  type FunctionPropertyNames,
  type NonFunctionPropertyNames,
  type MemoizedFunction,
  createConfigurableContextHook,
  isObject,
  isFunction,
  shallowEqual
};
