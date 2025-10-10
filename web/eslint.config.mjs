import antfu from '@antfu/eslint-config'

export default antfu({
  extends: [
    'eslint:recommended',
    'next',
    'next/core-web-vitals',
    'next/typescript',
    'plugin:@next/next/recommended',
  ],
})
