import { useToLogin } from "@/hooks/use-route";

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
