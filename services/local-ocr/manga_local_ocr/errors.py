"""只传递固定错误码，绝不回传依赖异常中的路径、图片或令牌。"""
class GatewayError(Exception):
    def __init__(self, code, status=422):
        self.code = code
        self.status = status
        super().__init__(code)
