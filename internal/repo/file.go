package repo

import (
	"strings"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
)

type FileRepo struct{}

var File = &FileRepo{}

func (f *FileRepo) Create(file *model.File) (err error) {
	return GetDB().Create(file).Error
}

func (f *FileRepo) GetByHash(hash string) (model.File, error) {
	var file model.File
	return file, GetDB().Where("hash = ?", hash).First(&file).Error
}

func (f *FileRepo) GetByID(id uint) (model.File, *errs.ServiceError) {
	var file model.File
	if err := GetDB().Where("id = ?", id).First(&file).Error; err != nil {
		return file, errs.NewNotFound("failed_to_get_target")
	}
	return file, nil
}

func (f *FileRepo) DeleteByID(id uint) error {
	return GetDB().Where("id = ?", id).Delete(&model.File{}).Error
}

func (f *FileRepo) CountFilesByProviderID(providerID uint) (int64, error) {
	var count int64
	err := GetDB().Model(&model.File{}).Where("provider_id = ?", providerID).Count(&count).Error
	return count, err
}

// CountFilesByHash 统计引用同一存储对象的文件记录数
func (f *FileRepo) CountFilesByHash(hash string, providerID uint) (int64, error) {
	var count int64
	err := GetDB().Model(&model.File{}).Where("hash = ? AND provider_id = ?", hash, providerID).Count(&count).Error
	return count, err
}

// ListFiles 列出文件；userID 为 0 时不限上传者，fileType 为空时不按类型筛选
func (f *FileRepo) ListFiles(userID uint, paginationParams *dto.PaginationParams, query []string, fileType string) ([]model.File, int64, error) {
	var files []model.File
	var total int64
	// 构建基础查询
	q := GetDB().Model(&model.File{})
	// 应用筛选条件
	if userID != 0 {
		q = q.Where("user_id = ?", userID)
	}
	if len(query) > 0 {
		for _, q_item := range query {
			if q_item != "" {
				q = q.Where("name LIKE ?", "%"+q_item+"%")
			}
		}
	}
	switch fileType {
	case constant.FileTypeImage, constant.FileTypeVideo, constant.FileTypeAudio:
		q = q.Where("mime_type LIKE ?", fileType+"/%")
	case constant.FileTypeOther:
		q = q.Where("mime_type NOT LIKE ? AND mime_type NOT LIKE ? AND mime_type NOT LIKE ?", "image/%", "video/%", "audio/%")
	}
	// 先获取总数
	countQuery := q.Session(&gorm.Session{}) // 创建新的会话，避免影响原查询
	if err := countQuery.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	// 应用分页和排序
	if paginationParams != nil {
		q = q.Offset(int(paginationParams.Offset())).
			Limit(int(paginationParams.Size)).
			Order(orderColumn(AllowedOrderBy(paginationParams.OrderBy, constant.OrderByEnumFile, constant.OrderByCreatedAt), paginationParams.Desc))
	}
	// 查询数据
	if err := q.Find(&files).Error; err != nil {
		return nil, 0, err
	}
	return files, total, nil
}

func (f *FileRepo) ListStorageProviders() (providers []model.StorageProviderModelAndDto, err error) {
	err = GetDB().Find(&providers).Error
	return
}

func (f *FileRepo) SetDefaultStorageProvider(id uint) error {
	return GetDB().Model(&model.StorageProviderModelAndDto{}).Where("id = ?", id).Update("is_default", true).Error
}

func (f *FileRepo) UnsetDefaultStorageProvider(id uint) *errs.ServiceError {
	if err := GetDB().Model(&model.StorageProviderModelAndDto{}).Where("id = ?", id).Update("is_default", false).Error; err != nil {
		return errs.NewInternalServer("failed_to_update_target")
	}
	return nil
}

func (f *FileRepo) CreateStorageProvider(provider *model.StorageProviderModelAndDto) *errs.ServiceError {
	// 取消其他默认提供者与创建放在同一事务，避免中途失败后没有默认存储
	if err := GetDB().Transaction(func(tx *gorm.DB) error {
		if provider.IsDefault {
			if err := tx.Model(&model.StorageProviderModelAndDto{}).Where("is_default = ?", true).Update("is_default", false).Error; err != nil {
				return err
			}
		}
		return tx.Create(provider).Error
	}); err != nil {
		return errs.NewInternalServer("failed_to_create_target")
	}
	return nil
}

func (f *FileRepo) UpdateStorageProvider(id uint, provider *model.StorageProviderModelAndDto) *errs.ServiceError {
	if err := GetDB().Transaction(func(tx *gorm.DB) error {
		if provider.IsDefault {
			if err := tx.Model(&model.StorageProviderModelAndDto{}).Where("is_default = ? AND id <> ?", true, id).Update("is_default", false).Error; err != nil {
				return err
			}
		}
		// Select("*") 让 false、空字符串等零值也能写入（如取消默认、关闭 path style）
		return tx.Model(&model.StorageProviderModelAndDto{}).Where("id = ?", id).
			Select("*").Omit("ID", "CreatedAt", "DeletedAt").Updates(provider).Error
	}); err != nil {
		return errs.NewInternalServer("failed_to_update_target")
	}
	return nil
}

func (f *FileRepo) DeleteStorageProvider(id uint) *errs.ServiceError {
	// 先检查是不是默认存储提供者
	var provider model.StorageProviderModelAndDto
	if err := GetDB().Where("id = ?", id).First(&provider).Error; err != nil {
		return errs.NewNotFound("failed_to_get_target")
	}
	if provider.IsDefault {
		return errs.NewBadRequest("cannot_delete_default_provider")
	}
	// 检查是否有文件或 HTML 页面版本在使用该存储提供者
	usage, err := f.ProviderUsage(id)
	if err != nil {
		return errs.NewInternalServer("failed_to_check_files")
	}
	if usage.InUse() {
		return errs.NewBadRequest("cannot_delete_provider_in_use")
	}
	// 删除存储提供者
	if err := GetDB().Where("id = ?", id).Delete(&model.StorageProviderModelAndDto{}).Error; err != nil {
		return errs.NewInternalServer("failed_to_delete_target")
	}
	return nil
}

// ListLocations 文件所在的存储与内容哈希（只查询这两列）
func (f *FileRepo) ListLocations(ids []uint) ([]model.File, error) {
	var files []model.File
	if len(ids) == 0 {
		return files, nil
	}
	err := GetDB().Select("id", "provider_id", "hash").Where("id IN ?", ids).Find(&files).Error
	return files, err
}

// ListByIDs 按 ID 批量读取文件记录，不存在的 ID 不返回
func (f *FileRepo) ListByIDs(ids []uint) ([]model.File, error) {
	var files []model.File
	if len(ids) == 0 {
		return files, nil
	}
	err := GetDB().Where("id IN ?", ids).Find(&files).Error
	return files, err
}

// FirstIDsByHash 存储中同一对象（哈希）对应的最小文件 ID，用于把直链还原为稳定链接
func (f *FileRepo) FirstIDsByHash(providerID uint, hashes []string) (map[string]uint, error) {
	result := make(map[string]uint, len(hashes))
	if len(hashes) == 0 {
		return result, nil
	}
	var rows []struct {
		Hash string
		ID   uint
	}
	if err := GetDB().Model(&model.File{}).Select("hash, MIN(id) AS id").
		Where("provider_id = ? AND hash IN ?", providerID, hashes).Group("hash").Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.Hash] = row.ID
	}
	return result, nil
}

// StorageObject 存储中的一个对象：同一存储内相同内容的文件共用一个对象
type StorageObject struct {
	ProviderID uint
	Hash       string
	Size       int64
}

// ListStorageObjects 待迁移的对象：fileIDs 为空时为 providerID 中的全部对象，否则为这些文件对应的对象
func (f *FileRepo) ListStorageObjects(providerID uint, fileIDs []uint) ([]StorageObject, error) {
	var objects []StorageObject
	q := GetDB().Model(&model.File{}).Select("provider_id, hash, MAX(size) AS size")
	if len(fileIDs) > 0 {
		q = q.Where("id IN ?", fileIDs)
	} else {
		q = q.Where("provider_id = ?", providerID)
	}
	err := q.Group("provider_id, hash").Order("provider_id, hash").Scan(&objects).Error
	return objects, err
}

// MoveObject 把引用该对象的文件记录改到目标存储；fileIDs 不为空时只移动其中的文件
func (f *FileRepo) MoveObject(object StorageObject, fileIDs []uint, targetID uint) error {
	q := GetDB().Model(&model.File{}).Where("provider_id = ? AND hash = ?", object.ProviderID, object.Hash)
	if len(fileIDs) > 0 {
		q = q.Where("id IN ?", fileIDs)
	}
	return q.UpdateColumn("provider_id", targetID).Error
}

// ProviderIDsOfFiles 文件所在的存储
func (f *FileRepo) ProviderIDsOfFiles(fileIDs []uint) ([]uint, error) {
	var ids []uint
	if len(fileIDs) == 0 {
		return ids, nil
	}
	err := GetDB().Model(&model.File{}).Where("id IN ?", fileIDs).Distinct().Pluck("provider_id", &ids).Error
	return ids, err
}

// StorageProviderUsage 存储提供者的占用情况
type StorageProviderUsage struct {
	Files            int64 `json:"files"`
	Bytes            int64 `json:"bytes"`
	PageHTMLVersions int64 `json:"page_html_versions"`
}

// InUse 仍有文件或 HTML 页面版本存放在该存储中
func (u StorageProviderUsage) InUse() bool {
	return u.Files > 0 || u.PageHTMLVersions > 0
}

// ListProviderUsage 各存储提供者的占用情况
func (f *FileRepo) ListProviderUsage() (map[uint]StorageProviderUsage, error) {
	var files []struct {
		ProviderID uint
		Files      int64
		Bytes      int64
	}
	if err := GetDB().Model(&model.File{}).Select("provider_id, COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes").
		Group("provider_id").Scan(&files).Error; err != nil {
		return nil, err
	}
	var versions []struct {
		ProviderID uint
		Versions   int64
	}
	if err := GetDB().Model(&model.PageHTMLVersion{}).Select("provider_id, COUNT(*) AS versions").
		Group("provider_id").Scan(&versions).Error; err != nil {
		return nil, err
	}
	usage := make(map[uint]StorageProviderUsage)
	for _, row := range files {
		u := usage[row.ProviderID]
		u.Files, u.Bytes = row.Files, row.Bytes
		usage[row.ProviderID] = u
	}
	for _, row := range versions {
		u := usage[row.ProviderID]
		u.PageHTMLVersions = row.Versions
		usage[row.ProviderID] = u
	}
	return usage, nil
}

// ProviderUsage 单个存储提供者的占用情况
func (f *FileRepo) ProviderUsage(providerID uint) (StorageProviderUsage, error) {
	var usage StorageProviderUsage
	if err := GetDB().Model(&model.File{}).Where("provider_id = ?", providerID).
		Select("COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes").Scan(&usage).Error; err != nil {
		return usage, err
	}
	err := GetDB().Model(&model.PageHTMLVersion{}).Where("provider_id = ?", providerID).Count(&usage.PageHTMLVersions).Error
	return usage, err
}

// fileLinkColumns 可能保存站内文件链接的文本列（含软删除的记录）
var fileLinkColumns = []struct {
	model   any
	columns []string
}{
	{&model.Post{}, []string{"content", "draft_content", "cover", "background_image"}},
	{&model.Page{}, []string{"content", "draft_content", "cover"}},
	{&model.User{}, []string{"avatar_url", "background_url"}},
	{&model.Comment{}, []string{"content"}},
	{&model.ContentRevision{}, []string{"content", "meta"}},
	{&model.OidcConfig{}, []string{"icon"}},
}

// fileLinkBatchSize 改写文本列时每批读取的行数
const fileLinkBatchSize = 200

// RewriteFileLinkColumns 改写所有包含 needles 之一的文本列，返回改动的行数；不触发钩子、不更新 updated_at
func (f *FileRepo) RewriteFileLinkColumns(needles []string, rewrite func(string) (string, bool)) (int, error) {
	if len(needles) == 0 {
		return 0, nil
	}
	changed := 0
	for _, target := range fileLinkColumns {
		var conds []string
		var args []any
		for _, column := range target.columns {
			for _, needle := range needles {
				conds = append(conds, column+" LIKE ?")
				args = append(args, "%"+needle+"%") // LIKE 只做粗筛，通配符误中的行由 rewrite 精确判断
			}
		}
		where := strings.Join(conds, " OR ")
		var lastID uint
		for {
			var rows []map[string]any
			if err := GetDB().Unscoped().Model(target.model).Select(append([]string{"id"}, target.columns...)).
				Where("id > ?", lastID).Where(where, args...).Order("id").Limit(fileLinkBatchSize).Find(&rows).Error; err != nil {
				return changed, err
			}
			for _, row := range rows {
				lastID = toUint(row["id"])
				updates := map[string]any{}
				for _, column := range target.columns {
					value, ok := toString(row[column])
					if !ok {
						continue
					}
					if next, ok := rewrite(value); ok {
						updates[column] = next
					}
				}
				if len(updates) == 0 {
					continue
				}
				if err := GetDB().Unscoped().Model(target.model).Where("id = ?", lastID).UpdateColumns(updates).Error; err != nil {
					return changed, err
				}
				changed++
			}
			if len(rows) < fileLinkBatchSize {
				break
			}
		}
	}
	return changed, nil
}

func toUint(v any) uint {
	switch n := v.(type) {
	case int64:
		return uint(n)
	case int32:
		return uint(n)
	case int:
		return uint(n)
	case uint64:
		return uint(n)
	case uint:
		return n
	}
	return 0
}

func toString(v any) (string, bool) {
	switch s := v.(type) {
	case string:
		return s, true
	case []byte:
		return string(s), true
	case *string:
		if s != nil {
			return *s, true
		}
	}
	return "", false
}

func (f *FileRepo) GetStorageProvider(id uint) (model.StorageProviderModelAndDto, error) {
	var provider model.StorageProviderModelAndDto
	err := GetDB().Where("id = ?", id).First(&provider).Error
	return provider, err
}
