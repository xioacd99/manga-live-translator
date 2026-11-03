# 冻结脚本计时文字更正

predictions.json中timing_scope末句将actual tensor shape和RSS统称wall外，不够准确：检测session代理 self.last_shape=list(tensor.shape) 位于engine调用内，计入wall；RSS读取在elapsed计算后，位于wall外。raw capture计入wall。四档均用相同观察路径，未因更正改动冻结脚本或参数。不能称无观察开销。首遍/后两warm记录独立，模型导入/初始化及锁等待单列。
