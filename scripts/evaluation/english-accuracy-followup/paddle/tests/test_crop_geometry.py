"""合成边界和退化四边形；不读取图片或GT。"""
import json
import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from crop_geometry import expanded_quad

class CropTests(unittest.TestCase):
    def test_fixed_scale(self):
        quad=np.array([[10,10],[30,10],[30,20],[10,20]])
        result,flags=expanded_quad(quad,(50,50,3),1.08,1.16)
        np.testing.assert_allclose(result,[[9.2,9.2],[30.8,9.2],[30.8,20.8],[9.2,20.8]],rtol=1e-6)
        self.assertFalse(flags['clamped'])
        json.dumps({'quad':result.tolist(),'flags':flags})
    def test_clamp_edges(self):
        quad=np.array([[0,0],[9,0],[9,9],[0,9]])
        result,flags=expanded_quad(quad,(10,10,3),1.08,1.16)
        self.assertTrue(flags['clamped']);self.assertTrue((result>=0).all());self.assertTrue((result<=9).all())
    def test_degenerate_rejected(self):
        with self.assertRaises(ValueError):expanded_quad(np.zeros((4,2)),(10,10,3),1.08,1.16)
        with self.assertRaises(ValueError):expanded_quad(np.zeros((4,2)),(1,1,3),1.08,1.16)
    def test_height_only(self):
        quad=np.array([[10,10],[30,10],[30,20],[10,20]])
        result,_=expanded_quad(quad,(50,50,3),1,1.16)
        np.testing.assert_array_equal(result[:,0],quad[:,0])
if __name__=='__main__':unittest.main()
