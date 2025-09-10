import { useEffect, useState } from "react";

export function useDevice() {
	const [isMobile, setIsMobile] = useState(false);

	useEffect(() => {
		// 简单判断移动端
		const check = () => {
			const ua = navigator.userAgent;
			setIsMobile(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua));
		};
		check();
		window.addEventListener("resize", check);
		return () => window.removeEventListener("resize", check);
	}, []);

	return { isMobile };
}
