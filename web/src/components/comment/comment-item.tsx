"use client";

import type { Comment } from "@/models/comment";
import { CardHeader, CardTitle } from "@/components/ui/card";
import {useState, useEffect} from "react";

export function CommentItem(comment: Comment){
    return (
        <div className="bg-white dark:bg-slate-800 shadow-sm rounded-lg p-4 mb-4">
            <CardHeader>
                <CardTitle className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                    {comment.user.nickname}
                </CardTitle>
            </CardHeader>
            <p className="text-sm text-slate-600 dark:text-slate-400">{comment.content}</p>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {new Date(comment.updatedAt).toLocaleString()}
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