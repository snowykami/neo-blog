import Link from 'next/link'
import { getCategories } from '@/api/post'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getCategoryUrl } from '@/utils/common/route'

export default async function CategoryPage() {
  const categories = await getCategories().then(res => res.data.categories).catch(() => [])

  return (
    <div className="py-10">
      <h1 className="text-3xl font-bold mb-6">分类</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {categories.map(category => (
          <Link key={category.id} href={getCategoryUrl(category)}>
            <Card className="h-full hover:border-primary transition-colors">
              <CardHeader>
                <CardTitle>{category.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                {category.description || category.slug}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
