"use client";

import type { Comment } from "@/models/comment";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { getGravatarByUser } from "@/components/common/gravatar";
import { useState, useEffect } from "react";
import { get } from "http";

export function CommentItem(comment: Comment) {
    const [replies, setReplies] = useState<Comment[]>([]);
    const [loadingReplies, setLoadingReplies] = useState(false);
    return (
        <div className="flex">
            <div>
                {getGravatarByUser(comment.user)}
            </div>
            <div className="flex-1 pl-2">
                <div className="font-bold">{comment.user.nickname}</div>
                <p className="text-xs text-slate-600 dark:text-slate-400">{comment.content}</p>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {new Date(comment.updatedAt).toLocaleString()}
                </div>
            </div>
        </div>
    );
}

function ReplyItem({ reply }: { reply: Comment }) {
    return (
        <div className="bg-gray-50 dark:bg-slate-700 shadow-sm rounded-lg p-4 mb-2 ml-4">
            <CardHeader>
                <CardTitle className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {reply.user.nickname}
                </CardTitle>
            </CardHeader>
            <p className="text-xs text-slate-600 dark:text-slate-400">{reply.content}</p>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {new Date(reply.updatedAt).toLocaleString()}
            </div>
        </div>
    );
}