import { AxiosError, AxiosResponse } from "axios";

export interface BaseResponse<T> {
    data: T;
    message: string;
    status: number;
}

export interface BaseErrorResponse<T = unknown, E = Record<string, unknown>> extends AxiosError<T> {
  response: AxiosResponse & {
    data: E & BaseResponse<null>;
  };
}