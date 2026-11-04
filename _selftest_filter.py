# 自测：会话筛选（只听）—— 纯函数，不碰微信、不碰 DSH
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bridge'))
import wechat_bridge as b  # noqa: E402

失败 = []


def 断言(名, 条件, 细节=''):
    print(('✓ ' if 条件 else '✗ ') + 名 + ('' if 条件 else '  ← ' + repr(细节)))
    if not 条件:
        失败.append(名)


选 = b.会话被选中

断言('空名单 = 全都听', 选('随便谁', 'wxid_x', []) is True, [])
断言('None 名单 = 全都听', 选('随便谁', 'wxid_x', None) is True, None)
断言('只有空白项 = 全都听', 选('随便谁', 'wxid_x', ['', '  ']) is True, ['', '  '])

断言('按显示名命中', 选('测试群', '123@chatroom', ['测试群']) is True, '测试群')
断言('名单外的会话不收', 选('另一个群', '456@chatroom', ['测试群']) is False, '另一个群')
断言('按群 id 命中（改备注也不怕）', 选('改了备注的群', '123@chatroom', ['123@chatroom']) is True, '123@chatroom')
断言('按 wxid 命中', 选('k2', 'wxid_k2', ['wxid_k2']) is True, 'wxid_k2')
断言('名字前后空格会被规整', 选('测试群', '', ['  测试群  ']) is True, '  测试群  ')

断言('群名命中就放行，即使 id 不在', 选('测试群', '999@chatroom', ['测试群', 'x']) is True, None)
断言('名单里混着空项也不影响', 选('另一个群', '456@chatroom', ['', '测试群']) is False, None)

if 失败:
    print('\n%d 条没过：%s' % (len(失败), '、'.join(失败)))
    sys.exit(1)
print('\n全部通过')
