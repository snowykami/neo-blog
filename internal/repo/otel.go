package repo

import (
	"errors"

	"github.com/snowykami/neo-blog/pkg/telemetry"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"gorm.io/gorm"
)

const gormOtelSpanKey = "neo_blog:otel_span"

type otelGormPlugin struct {
	dbSystem string
}

func newOtelGormPlugin(driver string) gorm.Plugin {
	dbSystem := driver
	if dbSystem == "postgres" {
		dbSystem = "postgresql"
	}
	return &otelGormPlugin{dbSystem: dbSystem}
}

func (p *otelGormPlugin) Name() string {
	return "neo-blog-otel-gorm"
}

func (p *otelGormPlugin) Initialize(db *gorm.DB) error {
	cb := db.Callback()
	if err := cb.Create().Before("gorm:create").Register("otel:before_create", p.before("INSERT")); err != nil {
		return err
	}
	if err := cb.Create().After("gorm:create").Register("otel:after_create", p.after); err != nil {
		return err
	}
	if err := cb.Query().Before("gorm:query").Register("otel:before_query", p.before("SELECT")); err != nil {
		return err
	}
	if err := cb.Query().After("gorm:query").Register("otel:after_query", p.after); err != nil {
		return err
	}
	if err := cb.Update().Before("gorm:update").Register("otel:before_update", p.before("UPDATE")); err != nil {
		return err
	}
	if err := cb.Update().After("gorm:update").Register("otel:after_update", p.after); err != nil {
		return err
	}
	if err := cb.Delete().Before("gorm:delete").Register("otel:before_delete", p.before("DELETE")); err != nil {
		return err
	}
	if err := cb.Delete().After("gorm:delete").Register("otel:after_delete", p.after); err != nil {
		return err
	}
	if err := cb.Row().Before("gorm:row").Register("otel:before_row", p.before("ROW")); err != nil {
		return err
	}
	if err := cb.Row().After("gorm:row").Register("otel:after_row", p.after); err != nil {
		return err
	}
	if err := cb.Raw().Before("gorm:raw").Register("otel:before_raw", p.before("RAW")); err != nil {
		return err
	}
	if err := cb.Raw().After("gorm:raw").Register("otel:after_raw", p.after); err != nil {
		return err
	}
	return nil
}

func (p *otelGormPlugin) before(op string) func(*gorm.DB) {
	return func(tx *gorm.DB) {
		if !telemetry.Enabled() || tx == nil || tx.Statement == nil || tx.Statement.Context == nil {
			return
		}
		ctx := tx.Statement.Context
		if !trace.SpanFromContext(ctx).IsRecording() {
			return
		}
		spanName := "gorm." + op
		if tx.Statement.Table != "" {
			spanName = op + " " + tx.Statement.Table
		}
		ctx, span := telemetry.Tracer("gorm").Start(
			ctx,
			spanName,
			trace.WithSpanKind(trace.SpanKindClient),
			trace.WithAttributes(
				attribute.String("db.system", p.dbSystem),
				attribute.String("db.operation.name", op),
			),
		)
		tx.Statement.Context = ctx
		tx.InstanceSet(gormOtelSpanKey, span)
	}
}

func (p *otelGormPlugin) after(tx *gorm.DB) {
	if tx == nil || tx.Statement == nil {
		return
	}
	raw, ok := tx.InstanceGet(gormOtelSpanKey)
	if !ok {
		return
	}
	span, ok := raw.(trace.Span)
	if !ok || span == nil {
		return
	}
	defer span.End()

	if tx.Statement.Table != "" {
		span.SetAttributes(attribute.String("db.collection.name", tx.Statement.Table))
	}
	span.SetAttributes(attribute.Int64("db.rows_affected", tx.RowsAffected))
	if tx.Error != nil && !errors.Is(tx.Error, gorm.ErrRecordNotFound) {
		span.RecordError(tx.Error)
		span.SetStatus(codes.Error, tx.Error.Error())
	}
}
