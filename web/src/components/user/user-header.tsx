"use client"
import { User } from "@/models/user";
import { Mail, User as UserIcon, Shield } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { getGravatarFromUser } from "@/utils/common/gravatar";
import { getFirstCharFromUser } from "@/utils/common/username";

export function UserHeader({ user }: { user: User }) {
  return (
    <div className="flex flex-col md:flex-row items-center md:items-center h-auto md:h-60">
      {/* 左侧 30%（头像容器） */}
      <div className="md:basis-[20%] flex justify-center items-center p-4">
        {/* wrapper 控制显示大小，父组件给具体 w/h */}
        <div className="w-40 h-40 md:w-48 md:h-48 relative">
          <Avatar className="h-full w-full rounded-full">
            <AvatarImage src={getGravatarFromUser({user})} alt={user.nickname} />
              <AvatarFallback className="rounded-full">{getFirstCharFromUser(user)}</AvatarFallback>
            </Avatar>
        </div>
      </div>

      {/* 右侧 70%（信息区） */}
      <div className="md:basis-[70%] p-4 flex flex-col justify-center space-y-2">
        <h2 className="text-2xl font-bold mt-0">{user.nickname || user.username || '未填写昵称'}</h2>
        <p className="text-gray-500 dark:text-gray-400 mt-1">@{user.username}</p>

        <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
          <UserIcon className="w-4 h-4 mr-2" />
          <span>{user.gender || '未填写'}</span>
        </div>

        <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
          <Mail className="w-4 h-4 mr-2" />
          <span>{user.email || '未填写'}</span>
        </div>

        <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
          <Shield className="w-4 h-4 mr-2" />
          <span>{user.role || '访客'}</span>
        </div>
        {/* 其他简介、按钮等放这里 */}
      </div>
    </div>
  );
}