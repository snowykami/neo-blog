import { useToLogin } from "@/hooks/use-to-login";

export default function NeedLogin(
    { children }: { children?: React.ReactNode }
) {
    const toLogin = useToLogin()
    return (
        <div onClick={toLogin}>
            {children}
        </div>
    );
}
