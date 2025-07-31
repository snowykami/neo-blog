"use client";
import { Textarea } from "@/components/ui/textarea"
import Gravatar from "@/components/common/gravatar"

export function CommentInput() {
    return (
        <div>
            <div className="flex py-4">
                {/* Avatar */}
                <div>
                    <Gravatar email="snowykami@outlook.com" className="w-10 h-10 rounded-full" />
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