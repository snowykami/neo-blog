import BlogHome from "@/components/blog-home/blog-home";
import { Metadata } from "next";
import {getTranslations} from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const routeT = await getTranslations('Route');
  return { title: routeT('homepage') };
}

export default function Page() {
  return <BlogHome />
}
