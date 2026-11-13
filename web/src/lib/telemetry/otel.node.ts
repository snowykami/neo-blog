import type { Context, ContextManager } from '@opentelemetry/api'
import { AsyncLocalStorage } from 'node:async_hooks'
import process from 'node:process'
import { context, propagation, ROOT_CONTEXT, trace } from '@opentelemetry/api'
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'

class AsyncLocalStorageContextManager implements ContextManager {
  private readonly storage = new AsyncLocalStorage<Context>()

  active(): Context {
    return this.storage.getStore() ?? ROOT_CONTEXT
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.storage.run(ctx, () => fn.apply(thisArg as ThisParameterType<F>, args))
  }

  bind<T>(ctx: Context, target: T): T {
    if (typeof target === 'function') {
      const bound = (...args: unknown[]) => this.with(ctx, target as (...a: unknown[]) => unknown, undefined, ...args)
      Object.defineProperty(bound, 'length', { value: target.length })
      return bound as unknown as T
    }
    return target
  }

  enable(): this {
    return this
  }

  disable(): this {
    this.storage.disable()
    return this
  }
}

let initialized = false

export function registerOTel() {
  if (initialized)
    return
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  if (!endpoint)
    return

  initialized = true
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  )

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || 'neo-blog-frontend'
  const resource = defaultResource().merge(
    resourceFromAttributes({ 'service.name': serviceName }),
  )

  const exporter = new OTLPTraceExporter()
  const provider = new TracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor({ exporter })],
  })
  trace.setGlobalTracerProvider(provider)
}
