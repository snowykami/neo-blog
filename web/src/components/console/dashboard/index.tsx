"use client"
import { getDashboard, DashboardResp } from "@/api/admin"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Eye, MessageCircle, Newspaper, Users } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import Link from "next/link"
import { IconType } from "@/types/icon"
import { consolePath } from "@/utils/common/route";
import { useAuth } from "@/contexts/auth-context"

export function Dashboard() {
  return (
    <div className="">
      <DataOverview />
    </div>
  )
}

function DataOverview() {
  const data: { key: keyof DashboardResp; label: string; icon: IconType; url: string }[] = [
    {
      key: "totalPosts",
      label: "Total Posts",
      icon: Newspaper,
      url: consolePath.post
    },
    {
      key: "totalUsers",
      label: "Total Users",
      icon: Users,
      url: consolePath.user
    },
    {
      key: "totalComments",
      label: "Total Comments",
      icon: MessageCircle,
      url: consolePath.comment
    },
    {
      key: "totalViews",
      label: "Total Views",
      icon: Eye,
      url: consolePath.file
    },
  ]
  const { user } = useAuth();
  const [fetchData, setFetchData] = useState<DashboardResp | null>(null);

  useEffect(() => {
    getDashboard().then(res => {
      setFetchData(res.data);
    }).catch(err => {
      toast.error(err.message || "Failed to fetch dashboard data");
    });
  }, [])

  if (!fetchData) return <div>Loading...</div>;

  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
    {data.map(item => (
      <Link key={item.key} href={item.url}>
        <Card key={item.key} className="p-4">
          <CardHeader className="pb-2 text-lg font-medium">
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl text-primary">
              <item.icon className="inline mr-2" />
              {fetchData[item.key]}
            </CardTitle>
          </CardHeader>
        </Card>
      </Link>
    ))}
  </div>
}