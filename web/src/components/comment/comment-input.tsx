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
import { useToLogin } from "@/hooks/use-to-login";
import NeedLogin from "../common/need-login";

export function CommentInput(
    { targetId, targetType, onCommentSubmitted }: { targetId: number, targetType: TargetType, onCommentSubmitted: () => void }
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
        <div>
            <div className="flex py-4">
                {/* Avatar */}
                <div onClick={user ? undefined : toLogin} className="flex-shrink-0 w-10 h-10">
                    {user && getGravatarByUser(user)}
                    {!user && <CircleUser className="w-full h-full" />}
                </div>
                {/* Input Area */}
                <div className="flex-1 pl-2">
                    <Textarea
                        placeholder={t("placeholder")}
                        className="w-full p-2 border border-gray-300 rounded-md"
                        value={commentContent}
                        onChange={(e) => setCommentContent(e.target.value)}
                    />
                </div>
            </div>
            <div className="flex justify-end">
                <button onClick={handleCommentSubmit} className="px-2 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors">
                    {t("submit")}
                </button>
            </div>
        </div>
    );
}