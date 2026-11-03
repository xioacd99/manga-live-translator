"""仅使用现造字符串测试解析器，不读取图片、模型、标注或真实识别输出。"""
import unittest
from parse_spotting import parse_spotting


def locations(values):
    """为合成测试生成八个标准坐标标记。"""
    return ''.join(f'<|LOC_{value}|>' for value in values)


class ParserTests(unittest.TestCase):
    """检查公开解析函数仍执行冻结协议中的坐标映射和严格拒绝逻辑。"""

    def setUp(self):
        self.coords = locations([100, 200, 400, 200, 400, 500, 100, 500])

    def test_bare_and_scale(self):
        value = parse_spotting('测试甲' + self.coords + '</s>', 640, 240)[0]
        self.assertEqual(value['text'], '测试甲')
        self.assertEqual(value['bbox'], [64, 48, 256, 120])
        self.assertEqual(value['polygon'], [[64, 48], [256, 48], [256, 120], [64, 120]])

    def test_wrapped(self):
        raw = '<|TEXT_START|>测试乙<|TEXT_END|><|LOC_BEGIN|>' + self.coords + '<|LOC_END|>'
        self.assertEqual(parse_spotting(raw, 1000, 1000)[0]['text'], '测试乙')

    def test_multiple(self):
        raw = '甲' + self.coords + '\n乙' + self.coords
        self.assertEqual(len(parse_spotting(raw, 1000, 1000)), 2)

    def test_trailing_text_rejects_whole_page(self):
        with self.assertRaises(ValueError):
            parse_spotting('甲' + self.coords + '\n未完成', 1000, 1000)

    def test_reject_incomplete(self):
        with self.assertRaises(ValueError):
            parse_spotting('甲' + locations([1] * 7), 1000, 1000)

    def test_reject_range(self):
        with self.assertRaises(ValueError):
            parse_spotting('甲' + locations([1001] * 8), 1000, 1000)

    def test_reject_degenerate(self):
        with self.assertRaises(ValueError):
            parse_spotting('甲' + locations([1] * 8), 1000, 1000)

    def test_reject_unknown_special(self):
        with self.assertRaises(ValueError):
            parse_spotting('<|UNKNOWN|>甲' + self.coords, 1000, 1000)

    def test_reject_empty(self):
        with self.assertRaises(ValueError):
            parse_spotting('', 1000, 1000)

    def test_reject_invalid_dimensions(self):
        with self.assertRaises(ValueError):
            parse_spotting('甲' + self.coords, 0, 1000)


if __name__ == '__main__':
    unittest.main()
