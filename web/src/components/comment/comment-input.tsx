"use client";
import { Textarea } from "@/components/ui/textarea"
import { getGravatarByUser } from "@/components/common/gravatar"

import { useState, useEffect } from "react";
import type { User } from "@/models/user";
import { getLoginUser } from "@/api/user";

export function CommentInput() {
    const [user, setUser] = useState<User | null>(null); // 假设 User 是你的用户模型
    useEffect(()=>{
        getLoginUser()
            .then(response => {
                setUser(response.data);
            })
            .catch(error => {
                console.error("获取用户信息失败:", error);
            });
    }, []);
    return (
        <div>
            <div className="flex py-4">
                {/* Avatar */}
                <div>
                    {user && getGravatarByUser(user)}
                </div>
                {/* Input Area */}
                <div className="flex-1 pl-2">
                    <Textarea placeholder="写下你的评论..." className="w-full p-2 border border-gray-300 rounded-md" />
                </div>
            </div>
            <div className="flex justify-end">
                <button className="px-2 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors">
                    提交
                </button>
            </div>
        </div>
    );
}