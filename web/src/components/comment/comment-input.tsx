"use client";
import { Textarea } from "@/components/ui/textarea"
import { getGravatarByUser } from "@/components/common/gravatar"
import { toast } from "sonner";
import { useState, useEffect } from "react";
import type { User } from "@/models/user";
import { getLoginUser } from "@/api/user";
import { createComment } from "@/api/comment";

import { CircleUser } from "lucide-react";
import { useTranslations } from "next-intl";
import { TargetType } from "@/models/types";
import { useToLogin } from "@/hooks/use-route";
import NeedLogin from "../common/need-login";


import "./comment-animations.css";

export function CommentInput(
    { targetId, targetType, replyId, onCommentSubmitted }: { targetId: number, targetType: TargetType, replyId: number | null, onCommentSubmitted: () => void }
) {

    const t = useTranslations('Comment')
    const toLogin = useToLogin()
    const [user, setUser] = useState<User | null>(null);
    const [commentContent, setCommentContent] = useState("");

    useEffect(() => {
        getLoginUser()
            .then(response => {
                setUser(response.data);
            })
    }, []);

    const handleCommentSubmit = async () => {
        if (!user) {
            toast.error(<NeedLogin>{t("login_required")}</NeedLogin>);
            return;
        }
        if (!commentContent.trim()) {
            toast.error(t("content_required"));
            return;
        }
        await createComment({
            targetType: targetType,
            targetId: targetId,
            content: commentContent,
            replyId: replyId,
            isPrivate: false,
        }).then(response => {
            setCommentContent("");
            toast.success(t("comment_success"));
            onCommentSubmitted();
        }).catch(error => {
            toast.error(t("comment_failed") + ": " +
                error?.response?.data?.message || error?.message
            );
        });
    };

    return (
        <div className="fade-in-up">
            <div className="flex py-4 fade-in">
                {/* Avatar */}
                <div onClick={user ? undefined : toLogin} className="flex-shrink-0 w-10 h-10 fade-in">
                    {user && getGravatarByUser(user)}
                    {!user && <CircleUser className="w-full h-full fade-in" />}
                </div>
                {/* Input Area */}
                <div className="flex-1 pl-2 fade-in-up">
                    <Textarea
                        placeholder={t("placeholder")}
                        className="w-full p-2 border border-gray-300 rounded-md fade-in-up"
                        value={commentContent}
                        onChange={(e) => setCommentContent(e.target.value)}
                    />
                </div>
            </div>
            <div className="flex justify-end fade-in-up">
                <button onClick={handleCommentSubmit} className="px-2 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors fade-in-up">
                    {t("submit")}
                </button>
            </div>
        </div>
    );
}