'use client'

import type { User } from '@/models/user'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getUserByUsername } from '@/api/user'
import { UserHeader } from './user-header'

export function UserPage() {
  const { username } = useParams() as { username: string }
  const [user, setUser] = useState<User | null>(null)
  useEffect(() => {
    getUserByUsername(username).then((res) => {
      setUser(res.data)
    })
  }, [username])

  if (!user) {
    return <div>Loading...</div>
  }
  return (
    <div>
      <UserHeader user={user} />
    </div>
  )
}
