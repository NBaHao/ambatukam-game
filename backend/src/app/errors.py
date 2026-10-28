"""Lỗi API: mọi response lỗi có dạng {"error": "<code>"} để client map sang thông báo."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    """Lỗi nghiệp vụ trả về cho client. `code` là chuỗi ổn định, client dựa vào nó."""

    def __init__(self, code: str, status_code: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


_HTTP_CODES = {404: "not_found", 405: "method_not_allowed"}


def error_response(code: str, status_code: int) -> JSONResponse:
    return JSONResponse({"error": code}, status_code=status_code)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.code, exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response("invalid_request", 422)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return error_response(_HTTP_CODES.get(exc.status_code, "http_error"), exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        print(f"unhandled error: {exc!r}")  # console.log của Worker, xem bằng `pywrangler tail`
        return error_response("server_error", 500)
