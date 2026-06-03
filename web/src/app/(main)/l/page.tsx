import Link from 'next/link'
import { getLabels } from '@/api/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getLabelUrl } from '@/utils/common/route'

export default async function LabelPage() {
  const labels = await getLabels().then(res => res.data.labels).catch(() => [])

  return (
    <div className="py-10">
      <h1 className="text-3xl font-bold mb-6">标签</h1>
      <Card>
        <CardHeader>
          <CardTitle>标签云</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {labels.map(label => (
              <Link key={label.id} href={getLabelUrl(label)}>
                <Badge variant="outline" className="text-sm cursor-pointer hover:bg-primary/10">
                  {label.name}
                  {typeof label.postCount === 'number' && (
                    <span className="ml-1 text-muted-foreground">
                      {label.postCount}
                    </span>
                  )}
                </Badge>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
