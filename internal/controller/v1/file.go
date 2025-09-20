package v1

import (
  "context"
  "io"
  "path/filepath"
  "strconv"

  "github.com/cloudwego/hertz/pkg/app"
  "github.com/sirupsen/logrus"
  "github.com/snowykami/neo-blog/internal/ctxutils"
  "github.com/snowykami/neo-blog/internal/model"
  "github.com/snowykami/neo-blog/internal/repo"
  "github.com/snowykami/neo-blog/pkg/filedriver"
  "github.com/snowykami/neo-blog/pkg/resps"
  "github.com/snowykami/neo-blog/pkg/utils"
)

type FileController struct{}

func NewFileController() *FileController {
  return &FileController{}
}

func (f *FileController) UploadFileStream(ctx context.Context, c *app.RequestContext) {
  // 获取文件信息
  file, err := c.FormFile("file")
  if err != nil {
    logrus.Error("无法读取文件: ", err)
    resps.BadRequest(c, err.Error())
    return
  }

  group := string(c.FormValue("group"))
  name := string(c.FormValue("name"))

  // 初始化文件驱动
  driver, err := filedriver.GetFileDriver(filedriver.GetWebdavDriverConfig())
  if err != nil {
    logrus.Error("获取文件驱动失败: ", err)
    resps.InternalServerError(c, "获取文件驱动失败")
    return
  }

  // 校验文件哈希
  if hashForm := string(c.FormValue("hash")); hashForm != "" {
    dir, fileName := utils.FilePath(hashForm)
    storagePath := filepath.Join(dir, fileName)
    if _, err := driver.Stat(c, storagePath); err == nil {
      resps.Ok(c, "文件已存在", map[string]any{"hash": hashForm})
      return
    }
  }

  // 打开文件
  src, err := file.Open()
  if err != nil {
    logrus.Error("无法打开文件: ", err)
    resps.BadRequest(c, err.Error())
    return
  }
  defer src.Close()

  // 计算文件哈希值
  hash, err := utils.FileHashFromStream(src)
  if err != nil {
    logrus.Error("计算文件哈希失败: ", err)
    resps.BadRequest(c, err.Error())
    return
  }

  // 根据哈希值生成存储路径
  dir, fileName := utils.FilePath(hash)
  storagePath := filepath.Join(dir, fileName)
  // 保存文件
  if _, err := src.Seek(0, io.SeekStart); err != nil {
    logrus.Error("无法重置文件流位置: ", err)
    resps.BadRequest(c, err.Error())
    return
  }
  if err := driver.Save(c, storagePath, src); err != nil {
    logrus.Error("保存文件失败: ", err)
    resps.InternalServerError(c, err.Error())
    return
  }
  // 数据库索引建立
  currentUser, ok := ctxutils.GetCurrentUser(ctx)
  if !ok {
    resps.InternalServerError(c, "获取当前用户失败")
    return
  }
  fileModel := &model.File{
    Hash:   hash,
    UserID: currentUser.ID,
    Group:  group,
    Name:   name,
  }

  if err := repo.File.Create(fileModel); err != nil {
    logrus.Error("数据库索引建立失败: ", err)
    resps.InternalServerError(c, "数据库索引建立失败")
    return
  }
  resps.Ok(c, "文件上传成功", map[string]any{"hash": hash, "id": fileModel.ID})
}

func (f *FileController) GetFile(ctx context.Context, c *app.RequestContext) {
  fileIdString := c.Param("id")
  fileId, err := strconv.ParseUint(fileIdString, 10, 64)
  if err != nil {
    logrus.Error("无效的文件ID: ", err)
    resps.BadRequest(c, "无效的文件ID")
    return
  }
  fileModel, err := repo.File.GetByID(uint(fileId))
  if err != nil {
    logrus.Error("获取文件信息失败: ", err)
    resps.InternalServerError(c, "获取文件信息失败")
    return
  }
  driver, err := filedriver.GetFileDriver(filedriver.GetWebdavDriverConfig())
  if err != nil {
    logrus.Error("获取文件驱动失败: ", err)
    resps.InternalServerError(c, "获取文件驱动失败")
    return
  }
  filePath := filepath.Join(utils.FilePath(fileModel.Hash))
  driver.Get(c, filePath)
}
