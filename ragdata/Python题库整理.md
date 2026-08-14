# Python 题库整理

---

## 目录

1. [基本运算：和差积商](#1-基本运算和差积商)
2. [时间格式与秒数计算](#2-时间格式与秒数计算)
3. [素数综合（判断 / 回文素数 / 素数求和）](#3-素数综合判断--回文素数--素数求和)
4. [出租车计费](#4-出租车计费)
5. [梯形法求积分](#5-梯形法求积分)
6. [二分法求方程根](#6-二分法求方程根)
7. [角谷猜想（3n+1）](#7-角谷猜想3n1)
8. [宝塔上的琉璃灯](#8-宝塔上的琉璃灯)
9. [字母组成判断（set vs Counter）](#9-字母组成判断set-vs-counter)
10. [月份天数](#10-月份天数)
11. [车牌号生成与通行判断](#11-车牌号生成与通行判断)
12. [字符串循环移位](#12-字符串循环移位)
13. [奇偶排序](#13-奇偶排序)
14. [找最年长者（出生日期）](#14-找最年长者出生日期)
15. [Counter 统计应用（出现次数 / 重复数据）](#15-counter-统计应用出现次数--重复数据)
16. [最长共有前缀](#16-最长共有前缀)
17. [罗马数字转整数](#17-罗马数字转整数)
18. [统计文本单词数](#18-统计文本单词数)
19. [通讯录操作（查询 / 删除）](#19-通讯录操作查询--删除)
20. [武汉商品房数据分析（CSV）](#20-武汉商品房数据分析csv)
21. [态密度图绘制（matplotlib）](#21-态密度图绘制matplotlib)

---

## 1. 基本运算：和差积商

**题目**：计算 2 个正整数的和、差、积、商并输出。题目保证输入和输出全部在整型范围内且除数不为 0。

**输入格式**：第一行正整数 A，第二行正整数 B

**输出格式**：4 行，格式 `A 运算符 B = 结果`

**参考代码**：
```python
def main():
    A = int(input())
    B = int(input())
    print(f"{A} + {B} = {A + B}")
    print(f"{A} - {B} = {A - B}")
    print(f"{A} * {B} = {A * B}")
    print(f"{A} / {B} = {A // B}")

if __name__ == "__main__":
    main()
```

---

## 2. 时间格式与秒数计算

**题目**：输入 24 小时制的小时、分钟、秒，以标准时间格式输出，并计算距离当日午夜 24 点整的秒数。

**输入格式**：分三行按顺序输入小时、分钟、秒

**参考代码**：
```python
def main():
    h = int(input())
    m = int(input())
    s = int(input())
    print(f"{h:02d}:{m:02d}:{s:02d}")
    total_seconds = h * 3600 + m * 60 + s
    print(86400 - total_seconds)

if __name__ == "__main__":
    main()
```

---

## 3. 素数综合（判断 / 回文素数 / 素数求和）

> 三道变体共享同一个 `is_prime` 模板，放在一起对比记忆。

### 3a. 素数输出

**题目**：找出 n 以内的所有素数，同行空格分隔输出。

```python
def is_prime(x):
    if x < 2:
        return False
    for i in range(2, int(x ** 0.5) + 1):
        if x % i == 0:
            return False
    return True

def main():
    n = int(input())
    for i in range(2, n + 1):
        if is_prime(i):
            print(i, end=' ')

if __name__ == "__main__":
    main()
```

### 3b. 回文素数

**题目**：输出小于 n 的所有回文素数（既是素数又是回文数）。

```python
def is_prime(x):
    if x < 2: return False
    for i in range(2, int(x ** 0.5) + 1):
        if x % i == 0: return False
    return True

def main():
    n = int(input())
    for i in range(2, n):
        if is_prime(i) and str(i) == str(i)[::-1]:
            print(i, end=' ')

if __name__ == "__main__":
    main()
```

### 3c. 最大的 10 个素数之和

**题目**：输入 n，统计 [0, n] 之间最大的 10 个素数之和，格式 `素数1+素数2+...=和`。

```python
def is_prime(x):
    if x < 2: return False
    for i in range(2, int(x ** 0.5) + 1):
        if x % i == 0: return False
    return True

def main():
    n = int(input())
    primes = [i for i in range(2, n + 1) if is_prime(i)][-10:]
    print('+'.join(map(str, primes)) + '=' + str(sum(primes)))

if __name__ == "__main__":
    main()
```

---

## 4. 出租车计费

**题目**：起步 3 公里 13 元；3~15 公里 2.3 元/公里；超 15 公里超出部分 3.45 元/公里；等待每分钟加 1 元。

**输入格式**：一行两个整数（里程, 等待分钟），逗号分隔

**参考代码**：
```python
def main():
    s, t = map(int, input().split(','))
    if s <= 3:
        fare = 13
    elif s <= 15:
        fare = 13 + (s - 3) * 2.3
    else:
        fare = 13 + 12 * 2.3 + (s - 15) * 3.45
    fare += t
    print(f"{fare:.0f}")

if __name__ == "__main__":
    main()
```

---

## 5. 梯形法求积分

**题目**：用梯形法计算 sin(x) 在 [a, b] 的积分值。

**输入格式**：第一行两个实数 a b，第二行切分数量 n

**参考代码**：
```python
import math

def main():
    a, b = map(float, input().split())
    n = int(input())
    dx = (b - a) / n
    area = 0.0
    for i in range(n):
        x1 = a + i * dx
        x2 = a + (i + 1) * dx
        area += (math.sin(x1) + math.sin(x2)) * dx / 2
    print(f"{area:.2f}")

if __name__ == "__main__":
    main()
```

---

## 6. 二分法求方程根

**题目**：f(x) = x⁵ − 15x⁴ + 85x³ − 225x² + 274x − 121，在 [1.5, 2.4] 有唯一根，用二分法求解。

**输入格式**：正整数 n，精度 10⁻ⁿ

**参考代码**：
```python
def f(x):
    return x**5 - 15*x**4 + 85*x**3 - 225*x**2 + 274*x - 121

def main():
    n = int(input())
    eps = 10 ** (-n)
    left, right = 1.5, 2.4
    while right - left > eps:
        mid = (left + right) / 2
        if f(mid) * f(left) > 0:
            left = mid
        else:
            right = mid
    print(f"{(left + right) / 2:.6f}")

if __name__ == "__main__":
    main()
```

---

## 7. 角谷猜想（3n+1）

**题目**：正整数偶数除 2，奇数乘 3 加 1，直到变为 1。输出每步结果和总步数。非正整数输出 `ERROR`。

**参考代码**：
```python
def main():
    n = int(input())
    if n <= 0:
        print("ERROR")
    else:
        count = 0
        while n != 1:
            print(n, end=' ')
            n = n // 2 if n % 2 == 0 else n * 3 + 1
            count += 1
        print(1)
        print(count)

if __name__ == "__main__":
    main()
```

---

## 8. 宝塔上的琉璃灯

**题目**：八层宝塔，每层灯数是上一层的 2 倍，共 765 盏。输出每层灯数。

**参考代码**：
```python
def main():
    x = 765 // (2**8 - 1)
    for i in range(8):
        print(x * (2 ** i))

if __name__ == "__main__":
    main()
```

---

## 9. 字母组成判断（set vs Counter）

> 两道变体的核心区别：**能否重复使用字母**。

### 9a. 可重复使用（用 set）

**题目**：判断 m 能否由 n 中的字母组成（字母可重复使用）。含非字母输出 `ERROR`。

```python
def main():
    m = input().strip()
    n = input().strip()
    if not m.isalpha():
        print("ERROR")
    else:
        letters = set(n)
        print("FOUND" if all(ch in letters for ch in m) else "NOT FOUND")

if __name__ == "__main__":
    main()
```

### 9b. 不可重复使用（用 Counter）

**题目**：同上，但 n 中每个字母只能用一次。

```python
from collections import Counter

def main():
    m = input().strip()
    n = input().strip()
    if not m.isalpha():
        print("ERROR")
    else:
        cnt_m, cnt_n = Counter(m), Counter(n)
        print("FOUND" if all(cnt_n[ch] >= cnt_m[ch] for ch in cnt_m) else "NOT FOUND")

if __name__ == "__main__":
    main()
```

**对比记忆**：
- 可重复 → `set(n)` + `all(ch in letters)`
- 不可重复 → `Counter` + 比较计数

---

## 10. 月份天数

**题目**：输入 8 位年月日字符串，输出该月天数（考虑闰年）。

**参考代码**：
```python
def main():
    s = input().strip()
    year = int(s[:4])
    month = int(s[4:6])
    leap = year % 400 == 0 or (year % 4 == 0 and year % 100 != 0)
    days = [31, 28 + leap, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    print(days[month - 1])

if __name__ == "__main__":
    main()
```

---

## 11. 车牌号生成与通行判断

> 生成与验证是一对，放在一起理解车牌号规则。

### 11a. 随机生成车牌号

**规则**：`鄂A-` / `鄂W-` 开头，后 5 位最多 2 个字母（不含 I、O），其余数字。

```python
import random, string

letters_ok = string.ascii_uppercase.replace('I', '').replace('O', '')

def generate_plate():
    t = random.randint(0, 2)
    pool = random.choices(letters_ok, k=t) + random.choices(string.digits, k=5-t)
    random.shuffle(pool)
    return random.choice(['鄂A-', '鄂W-']) + ''.join(pool)

def main():
    seed_val = int(input())
    n = int(input())
    random.seed(seed_val)
    print([generate_plate() for _ in range(n)])

if __name__ == "__main__":
    main()
```

### 11b. 单双号通行判断

**规则**：找车牌中最后一位数字，奇数→单号，偶数→双号。格式非法→`Data Error!`。

```python
def main():
    s = input().strip()
    if len(s) != 8 or s[:3] != '鄂A-':
        print("Data Error!")
    else:
        tail = s[3:]
        if not all(c.isdigit() or (c.isupper() and c not in 'IO') for c in tail):
            print("Data Error!")
        elif sum(c.isupper() for c in tail) > 2:
            print("Data Error!")
        else:
            last_digit = None
            for c in reversed(tail):
                if c.isdigit():
                    last_digit = int(c)
                    break
            if last_digit is None:
                print("Data Error!")
            else:
                print("单号通行" if last_digit % 2 else "双号通行")

if __name__ == "__main__":
    main()
```

---

## 12. 字符串循环移位

**题目**：将字符串 s 循环移动 n 位。正数右移，负数左移。

**参考代码**：
```python
def main():
    s = input().strip()
    n = int(input())
    if not s:
        print('')
    else:
        n = n % len(s)
        print(s[-n:] + s[:-n])  # 右移 n 位

if __name__ == "__main__":
    main()
```

> 左移 n 位：`s[n:] + s[:n]`

---

## 13. 奇偶排序

**题目**：列表 A 中奇偶各半，分别排序后按原位放回（偶数位放偶数，奇数位放奇数）。

**参考代码**：
```python
def main():
    A = list(map(int, input().split()))
    odds = sorted([x for x in A if x % 2 == 1])
    evens = sorted([x for x in A if x % 2 == 0])
    if len(odds) != len(evens):
        print("ERROR")
    else:
        result = []
        oi, ei = 0, 0
        for i in range(len(A)):
            if i % 2 == 0:
                result.append(evens[ei]); ei += 1
            else:
                result.append(odds[oi]); oi += 1
        print(result)

if __name__ == "__main__":
    main()
```

---

## 14. 找最年长者（出生日期）

**题目**：输入若干 yyyy-mm-dd 日期（空行结束），找出年龄最大者（日期最早）。

**参考代码**：
```python
def main():
    dates = []
    while True:
        s = input().strip()
        if s == '':
            break
        dates.append(s)
    print(sorted(dates)[0])

if __name__ == "__main__":
    main()
```

---

## 15. Counter 统计应用（出现次数 / 重复数据）

> 两道变体都用 `Counter`，区别仅在筛选条件。

### 15a. 出现次数等于该数的值

**题目**：找出现次数恰好等于自身的数，输出最大者，不存在输出 −1。

```python
from collections import Counter

def main():
    nums = list(map(int, input().split()))
    cnt = Counter(nums)
    ans = -1
    for k, v in cnt.items():
        if k == v and k > ans:
            ans = k
    print(ans)

if __name__ == "__main__":
    main()
```

### 15b. 找出重复数据

**题目**：输出出现次数 > 1 的数，从小到大排列。

```python
from collections import Counter

def main():
    nums = list(map(int, input().split()))
    print(sorted(k for k, v in Counter(nums).items() if v > 1))

if __name__ == "__main__":
    main()
```

### 补充：出现奇数次的数据（异或法）

**题目**：只有一个数出现奇数次，其余偶数次，找出它。

```python
def main():
    nums = list(map(int, input().split()))
    result = 0
    for num in nums:
        result ^= num
    print(result)

if __name__ == "__main__":
    main()
```

> **三种统计场景速记**：
> - 条件筛选 → `Counter` + dict 推导
> - 找奇数次 → 异或 `^`

---

## 16. 最长共有前缀

**题目**：输入若干字符串，找最长公共前缀，不存在输出 `NOT FOUND`。

**参考代码**：
```python
def main():
    strings = input().split()
    if not strings:
        print("NOT FOUND")
    else:
        prefix = strings[0]
        for s in strings[1:]:
            while not s.startswith(prefix):
                prefix = prefix[:-1]
                if not prefix: break
            if not prefix: break
        print(prefix if prefix else "NOT FOUND")

if __name__ == "__main__":
    main()
```

---

## 17. 罗马数字转整数

**题目**：I(1), V(5), X(10), L(50), C(100), D(500), M(1000)，特殊情况 IV=4, IX=9 等。

**参考代码**：
```python
def main():
    s = input().strip()
    roman = {'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000}
    total = prev = 0
    for ch in reversed(s):
        cur = roman[ch]
        total += -cur if cur < prev else cur
        prev = cur
    print(total)

if __name__ == "__main__":
    main()
```

> **技巧**：反向遍历，当前值 < 前一个值则减，否则加。

---

## 18. 统计文本单词数

**题目**：读取文本文件，统计单词数。标点（除单引号）和空白都是分隔符。

**参考代码**：
```python
import string

def main():
    filename = input().strip()
    with open(filename, 'r', encoding='utf-8') as f:
        text = f.read()
    for ch in string.punctuation.replace("'", ''):
        text = text.replace(ch, ' ')
    print(len(text.split()))

if __name__ == "__main__":
    main()
```

---

## 19. 通讯录操作（查询 / 删除）

> 同一字典的两种操作，对比记忆增删查改。

**初始数据**：
```python
dic = {'张自强': ['12652141777', '材料'],
       '庚同硕': ['14388240417', '自动化'],
       '王岩': ['11277291473', '文法']}
```

### 19a. 查询（输入 `4`）

```python
def main():
    dic = {'张自强': ['12652141777', '材料'],
           '庚同硕': ['14388240417', '自动化'],
           '王岩': ['11277291473', '文法']}
    choice = input().strip()
    if choice == '4':
        name = input().strip()
        if name in dic:
            print(f"{name} {' '.join(dic[name])}")
            print("Success")
        else:
            print("No Record")
        print(dic)
    else:
        print("ERROR")

if __name__ == "__main__":
    main()
```

### 19b. 删除（输入 `2`）

```python
def main():
    dic = {'张自强': ['12652141777', '材料'],
           '庚同硕': ['14388240417', '自动化'],
           '王岩': ['11277291473', '文法']}
    choice = input().strip()
    if choice == '2':
        name = input().strip()
        if name in dic:
            del dic[name]
            print("Success")
        else:
            print("No Record")
        print(dic)
    else:
        print("ERROR")

if __name__ == "__main__":
    main()
```

---

## 20. 武汉商品房数据分析（CSV）

**题目**：读取 `wuhan2021s1.csv`，按输入选项执行：规模升序 / 降序 / 按区筛选 / 总规模。

**参考代码**：
```python
import csv

def main():
    with open('wuhan2021s1.csv', 'r', encoding='utf-8') as f:
        data = list(csv.DictReader(f))

    n = input().strip()

    if n == '规模升序':
        data.sort(key=lambda x: float(x['可售住宅总规模']))
        for row in data: print(' '.join(row.values()))

    elif n == '规模降序':
        data.sort(key=lambda x: float(x['可售住宅总规模']), reverse=True)
        for row in data: print(' '.join(row.values()))

    elif n in {row['区属'] for row in data}:
        total = 0.0
        for row in data:
            if row['区属'] == n:
                print(' '.join(row.values()))
                total += float(row['可售住宅总规模'])
        print(f"{total:.2f}")

    elif n == '总规模':
        print(f"{sum(float(r['可售住宅总规模']) for r in data):.2f}")

    else:
        print("错误输入")

if __name__ == "__main__":
    main()
```

---

## 21. 态密度图绘制（matplotlib）

**题目**：读取 `DosOfBaTiO3.txt`，绘制态密度曲线并保存为图片。

**参考代码**：
```python
import matplotlib.pyplot as plt
import os

def main():
    # 自适应定位文件
    file_path = 'DosOfBaTiO3.txt'
    if not os.path.exists(file_path):
        for root, dirs, files in os.walk('.'):
            for f in files:
                if "DosOfBaTiO3" in f:
                    file_path = os.path.join(root, f)
                    break

    # 读取数据（忽略空行和表头）
    x_data, y_data = [], []
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 2:
                try:
                    x_data.append(float(parts[0]))
                    y_data.append(float(parts[1]))
                except ValueError:
                    continue

    # 绘图
    plt.plot(x_data, y_data, color='red', linewidth=1)
    plt.xlabel("Energy(Ha)")
    plt.ylabel("Density of States(electrons/Ha)")

    os.makedirs("output", exist_ok=True)
    plt.savefig("output/exam.png")
    plt.show()

if __name__ == "__main__":
    main()
```

---

## 常用知识点速查

---

### 一、变量与数据类型

```python
# 类型转换
int("123")       # 字符串 → 整数
float("3.14")    # 字符串 → 浮点数
str(100)         # 整数 → 字符串
bool(0)          # 0/空值 → False，其余 → True

# 多重赋值
a, b = 1, 2
a, b = b, a      # 交换两值

# 类型判断
type(x)          # 返回类型
isinstance(x, int)  # 是否为某类型
```

---

### 二、字符串操作

```python
s = "Hello, World!"

# 取值
s[0]             # 'H'
s[-1]            # '!'
s[2:5]           # 'llo'（左闭右开）
s[::-1]          # 反转字符串

# 常用方法
s.lower()        # 全小写
s.upper()        # 全大写
s.strip()        # 去首尾空白
s.split(',')     # 按逗号分割 → 列表
s.replace('a', 'b')  # 替换
s.find('lo')     # 找子串位置，找不到返回 -1
s.count('l')     # 统计出现次数
s.startswith('He')   # 前缀判断
s.endswith('!')      # 后缀判断
s.join(['a','b'])    # 用 s 连接列表 → 'aHeb'

# 判断类
s.isdigit()      # 全是数字
s.isalpha()      # 全是字母
s.isalnum()      # 数字或字母
s.isupper()      # 全大写
s.islower()      # 全小写

# 格式化
f"{name} is {age}"           # f-string（推荐）
"{} is {}".format(name, age) # format 方法
"%s is %d" % (name, age)     # % 格式化（旧式）
```

---

### 三、列表操作

```python
ls = [1, 2, 3, 4, 5]

# 增
ls.append(6)         # 末尾追加
ls.insert(0, 0)      # 指定位置插入
ls.extend([7, 8])    # 追加多个元素

# 删
ls.remove(3)         # 删除第一个值为 3 的
ls.pop()             # 弹出末尾元素
ls.pop(0)            # 弹出指定位置
del ls[0]            # 删除指定位置
ls.clear()           # 清空

# 查
ls.index(3)          # 第一个值为 3 的下标
ls.count(3)          # 值为 3 的个数
3 in ls              # 是否存在 → True/False
len(ls)              # 长度

# 排序
ls.sort()            # 原地升序
ls.sort(reverse=True)  # 原地降序
ls.reverse()         # 原地反转
sorted(ls)           # 返回新列表，不改原列表

# 切片
ls[1:3]              # [2, 3]（左闭右开）
ls[::2]              # 步长为 2 → [1, 3, 5]
ls[::-1]             # 反转
```

---

### 四、字典操作

```python
d = {'name': 'Tom', 'age': 20}

# 增/改
d['age'] = 21        # 修改
d['score'] = 90      # 新增
d.update({'a': 1})   # 批量更新

# 删
del d['age']         # 删除指定键
d.pop('age')         # 删除并返回值
d.clear()            # 清空

# 查
d['name']            # 取值（键不存在会报错）
d.get('name', '')    # 取值（键不存在返回默认值）
'name' in d          # 判断键是否存在
d.keys()             # 所有键
d.values()           # 所有值
d.items()            # 所有键值对

# 遍历
for k, v in d.items():
    print(k, v)
```

---

### 五、元组与集合

```python
# 元组（不可变）
t = (1, 2, 3)
t[0]                 # 取值
a, b, c = t          # 解包

# 集合（去重、集合运算）
s = {1, 2, 3}
s.add(4)             # 添加
s.discard(2)         # 删除（不存在不报错）
s1 & s2              # 交集
s1 | s2              # 并集
s1 - s2              # 差集
```

---

### 六、条件与循环

```python
# 条件
if x > 0:
    ...
elif x == 0:
    ...
else:
    ...

# 三元表达式
result = "正" if x > 0 else "非正"

# for 循环
for i in range(5):          # 0,1,2,3,4
for i in range(1, 10):      # 1~9
for i in range(0, 10, 2):   # 0,2,4,6,8（步长2）
for ch in "abc":            # 遍历字符串
for i, v in enumerate(ls):  # 带下标遍历

# while 循环
while x > 0:
    x -= 1

# break / continue / else
for i in range(10):
    if i == 5: break       # 跳出循环
    if i == 3: continue    # 跳过本次
else:
    print("循环正常结束")   # 没被 break 时执行
```

---

### 七、列表推导式

```python
# 基本
[x**2 for x in range(10)]             # [0,1,4,9,...,81]

# 带条件
[x for x in range(10) if x % 2 == 0]  # 偶数

# 嵌套
[(i, j) for i in range(3) for j in range(3)]

# 字典推导式
{k: v for k, v in zip(keys, vals)}

# 集合推导式
{x % 3 for x in range(10)}            # {0, 1, 2}
```

---

### 八、函数定义

```python
# 基本
def add(a, b):
    return a + b

# 默认参数
def greet(name, msg="你好"):
    return f"{msg}, {name}!"

# 可变参数
def calc(*args):          # 接收任意个位置参数（元组）
    return sum(args)

def show(**kwargs):       # 接收任意个关键字参数（字典）
    for k, v in kwargs.items():
        print(k, v)

# lambda 匿名函数
f = lambda x: x ** 2
sorted(ls, key=lambda x: x[1])  # 按第二项排序
```

---

### 九、常用内置函数

```python
len(s)             # 长度
max(1, 2, 3)       # 最大值
min(1, 2, 3)       # 最小值
sum([1, 2, 3])     # 求和
abs(-5)            # 绝对值
round(3.14, 1)     # 四舍五入 → 3.1
pow(2, 10)         # 幂运算 → 1024
divmod(17, 5)      # (商, 余数) → (3, 2)
range(5)           # 0~4
enumerate(ls)      # 带下标迭代
zip(a, b)          # 并行迭代
map(int, ls)       # 映射
filter(bool, ls)   # 过滤
reversed(ls)       # 反转迭代器
any([0, 0, 1])     # 有一个为真 → True
all([1, 1, 1])     # 全为真 → True
```

---

### 十、异常处理

```python
try:
    x = int(input())
except ValueError:
    print("输入不是整数")
except (TypeError, KeyError):
    print("类型或键错误")
except Exception as e:
    print(f"未知错误: {e}")
else:
    print("没有异常时执行")
finally:
    print("无论如何都执行")
```

---

### 十一、文件读写

```python
# 读文件
with open('data.txt', 'r', encoding='utf-8') as f:
    content = f.read()          # 读全部
    # lines = f.readlines()     # 读所有行 → 列表
    # for line in f:            # 逐行读（内存友好）
    #     print(line.strip())

# 写文件
with open('out.txt', 'w', encoding='utf-8') as f:
    f.write("Hello\n")

# 追加写
with open('out.txt', 'a', encoding='utf-8') as f:
    f.write("World\n")
```

---

### 十二、排序进阶

```python
# key 函数排序
sorted(students, key=lambda s: s['age'])             # 按字典某字段
sorted(students, key=lambda s: (s['age'], s['name'])) # 多条件排序
sorted(ls, key=abs)                                   # 按绝对值排序

# 排序 + 去重
sorted(set(ls))

# 获取最大/最小的 N 个
import heapq
heapq.nlargest(3, ls)    # 最大的 3 个
heapq.nsmallest(3, ls)   # 最小的 3 个
```

---

### 十三、数学相关

```python
import math

math.sqrt(16)       # 平方根 → 4.0
math.ceil(3.2)      # 向上取整 → 4
math.floor(3.8)     # 向下取整 → 3
math.log(100, 10)   # 对数 → 2.0
math.pi             # 圆周率 3.14159...
math.gcd(12, 8)     # 最大公约数 → 4
math.factorial(5)   # 阶乘 → 120
math.sin(math.pi/6) # 三角函数（弧度制）
```

---

### 十四、输入输出速查

| 操作 | 代码 |
|------|------|
| 一个整数 | `int(input())` |
| 一行两个整数 | `map(int, input().split())` |
| 一行逗号分隔 | `map(int, input().split(','))` |
| 一行多个整数 → 列表 | `list(map(int, input().split()))` |
| 格式化输出 | `print(f"{value:.2f}")` |

---

### 素数判断模板
```python
def is_prime(x):
    if x < 2: return False
    for i in range(2, int(x ** 0.5) + 1):
        if x % i == 0: return False
    return True
```

### 回文判断
```python
s == s[::-1]
```

### 计数工具
```python
from collections import Counter
cnt = Counter(iterable)
```

### 异或找奇数次
```python
result = 0
for num in nums:
    result ^= num
```

### 闰年判断
```python
year % 400 == 0 or (year % 4 == 0 and year % 100 != 0)
```

### 罗马数字反向遍历法
```python
roman = {'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000}
total, prev = 0, 0
for ch in reversed(s):
    cur = roman[ch]
    total += -cur if cur < prev else cur
    prev = cur
```

### 文件与目录
```python
os.makedirs("output", exist_ok=True)  # 自动建目录
os.walk('.')                          # 递归搜索文件
```
