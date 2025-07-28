import { headers } from "next/headers";

export async function isMobileByUA() {
    const headerList = await headers();
    const ua = headerList.get("user-agent") || "";
    return /mobile|android|iphone|ipad|phone/i.test(ua);
}
