#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
小说内容管理工具
功能：
1. 自动生成章节文件并添加Front Matter
2. 批量转换文档格式（WPS/Word → Markdown）
3. 自动按正确目录结构组织文件
4. 提供预览功能
"""

import os
import sys
import time
import json
import argparse
import subprocess
from datetime import datetime
from tkinter import Tk, filedialog, simpledialog, messagebox, ttk, Frame, Label, Button, Entry, Checkbutton, BooleanVar
import tkinter as tk

# 全局配置
CONFIG = {
    'content_dir': 'content/novel-collections',
    'default_access_key': 'novel2024',
    'auto_backup_enabled': True,
    'backup_dir': 'backups',
    'editor': 'notepad.exe'  # Windows默认编辑器
}

class NovelManager:
    def __init__(self, root):
        self.root = root
        self.root.title("小说内容管理工具")
        self.root.geometry("800x600")
        self.root.resizable(True, True)
        
        # 创建标签页
        self.tab_control = ttk.Notebook(root)
        
        # 主标签页
        self.main_tab = ttk.Frame(self.tab_control)
        self.tab_control.add(self.main_tab, text="内容管理")
        
        # 转换工具标签页
        self.convert_tab = ttk.Frame(self.tab_control)
        self.tab_control.add(self.convert_tab, text="格式转换")
        
        # 配置标签页
        self.config_tab = ttk.Frame(self.tab_control)
        self.tab_control.add(self.config_tab, text="配置")
        
        # 备份标签页
        self.backup_tab = ttk.Frame(self.tab_control)
        self.tab_control.add(self.backup_tab, text="备份管理")
        
        self.tab_control.pack(expand=1, fill="both")
        
        # 初始化各个标签页
        self.init_main_tab()
        self.init_convert_tab()
        self.init_config_tab()
        self.init_backup_tab()
        
        # 加载配置
        self.load_config()
        
    def load_config(self):
        """加载配置文件"""
        config_file = 'novel_manager_config.json'
        if os.path.exists(config_file):
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    loaded_config = json.load(f)
                    CONFIG.update(loaded_config)
                    # 更新界面配置
                    self.content_dir_entry.delete(0, tk.END)
                    self.content_dir_entry.insert(0, CONFIG['content_dir'])
                    self.backup_dir_entry.delete(0, tk.END)
                    self.backup_dir_entry.insert(0, CONFIG['backup_dir'])
                    self.editor_entry.delete(0, tk.END)
                    self.editor_entry.insert(0, CONFIG['editor'])
                    self.auto_backup_var.set(CONFIG['auto_backup_enabled'])
            except:
                messagebox.showerror("错误", "加载配置文件失败")
    
    def save_config(self):
        """保存配置文件"""
        config_file = 'novel_manager_config.json'
        try:
            with open(config_file, 'w', encoding='utf-8') as f:
                json.dump(CONFIG, f, ensure_ascii=False, indent=2)
            messagebox.showinfo("成功", "配置已保存")
        except:
            messagebox.showerror("错误", "保存配置文件失败")
    
    def init_main_tab(self):
        """初始化主标签页"""
        # 创建左侧导航
        nav_frame = Frame(self.main_tab, width=200, bd=1, relief=tk.SUNKEN)
        nav_frame.pack(side=tk.LEFT, fill=tk.Y, padx=5, pady=5)
        
        # 创建右侧内容区
        content_frame = Frame(self.main_tab)
        content_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 导航按钮
        Button(nav_frame, text="创建小说集", command=self.create_collection, width=15, pady=5).pack(pady=5)
        Button(nav_frame, text="创建分卷", command=self.create_volume, width=15, pady=5).pack(pady=5)
        Button(nav_frame, text="创建章节", command=self.create_chapter, width=15, pady=5).pack(pady=5)
        Button(nav_frame, text="浏览内容", command=self.browse_content, width=15, pady=5).pack(pady=5)
        Button(nav_frame, text="启动预览", command=self.start_preview, width=15, pady=5).pack(pady=5)
        
        # 内容区标题
        Label(content_frame, text="小说内容管理工具", font=("SimHei", 16)).pack(pady=20)
        Label(content_frame, text="欢迎使用小说内容管理工具！\n请从左侧选择操作。", font=("SimHei", 12)).pack(pady=10)
        
        # 显示当前结构
        self.structure_text = tk.Text(content_frame, wrap=tk.WORD, height=10, width=50)
        self.structure_text.pack(pady=10, fill=tk.BOTH, expand=True)
        self.update_structure_view()
    
    def update_structure_view(self):
        """更新内容结构视图"""
        self.structure_text.delete(1.0, tk.END)
        try:
            if not os.path.exists(CONFIG['content_dir']):
                self.structure_text.insert(tk.END, "内容目录不存在，请检查配置")
                return
            
            self.structure_text.insert(tk.END, "当前内容结构：\n\n")
            
            # 遍历内容目录
            for collection in os.listdir(CONFIG['content_dir']):
                collection_path = os.path.join(CONFIG['content_dir'], collection)
                if not os.path.isdir(collection_path):
                    continue
                
                self.structure_text.insert(tk.END, f"📚 小说集: {collection}\n")
                
                # 遍历分卷
                for volume in os.listdir(collection_path):
                    volume_path = os.path.join(collection_path, volume)
                    if not os.path.isdir(volume_path):
                        continue
                    
                    self.structure_text.insert(tk.END, f"  📖 分卷: {volume}\n")
                    
                    # 遍历章节
                    chapters = []
                    for item in os.listdir(volume_path):
                        if item.endswith('.md'):
                            chapters.append(item)
                    
                    if chapters:
                        chapters.sort()
                        for chapter in chapters:
                            chapter_name = chapter[:-3]  # 移除.md扩展名
                            self.structure_text.insert(tk.END, f"    📄 章节: {chapter_name}\n")
                    else:
                        self.structure_text.insert(tk.END, "    (暂无章节)\n")
                
                self.structure_text.insert(tk.END, "\n")
        except Exception as e:
            self.structure_text.insert(tk.END, f"获取结构时出错: {str(e)}")
    
    def create_collection(self):
        """创建新的小说集"""
        collection_name = simpledialog.askstring("创建小说集", "请输入小说集名称：")
        if not collection_name:
            return
        
        # 检查名称是否合法
        if not self.is_valid_name(collection_name):
            messagebox.showerror("错误", "名称包含非法字符")
            return
        
        collection_path = os.path.join(CONFIG['content_dir'], collection_name)
        
        # 检查目录是否已存在
        if os.path.exists(collection_path):
            messagebox.showerror("错误", "小说集已存在")
            return
        
        try:
            # 创建目录
            os.makedirs(collection_path)
            
            # 创建_index.md文件
            index_file = os.path.join(collection_path, "_index.md")
            with open(index_file, 'w', encoding='utf-8') as f:
                f.write(f"---\ntitle: \"{collection_name}\"\ndate: {datetime.now().strftime('%Y-%m-%dT%H:%M:%S+08:00')}\ndraft: false\n---\n\n# {collection_name}\n\n小说集简介")
            
            messagebox.showinfo("成功", f"小说集 '{collection_name}' 创建成功")
            self.update_structure_view()
            
            # 自动备份
            if CONFIG['auto_backup_enabled']:
                self.perform_backup(f"创建小说集: {collection_name}")
        except Exception as e:
            messagebox.showerror("错误", f"创建小说集失败: {str(e)}")
    
    def create_volume(self):
        """创建新的分卷"""
        # 获取小说集列表
        collections = []
        if os.path.exists(CONFIG['content_dir']):
            for item in os.listdir(CONFIG['content_dir']):
                if os.path.isdir(os.path.join(CONFIG['content_dir'], item)):
                    collections.append(item)
        
        if not collections:
            messagebox.showerror("错误", "请先创建小说集")
            return
        
        # 选择小说集
        collection_window = Tk()
        collection_window.title("选择小说集")
        collection_window.geometry("300x200")
        
        Label(collection_window, text="请选择小说集：").pack(pady=10)
        
        selected_collection = tk.StringVar(value=collections[0])
        collection_listbox = tk.Listbox(collection_window, height=5)
        for collection in collections:
            collection_listbox.insert(tk.END, collection)
        collection_listbox.pack(pady=10, fill=tk.BOTH, expand=True)
        
        def on_select():
            if collection_listbox.curselection():
                selected_collection.set(collection_listbox.get(collection_listbox.curselection()))
                collection_window.destroy()
                self._create_volume_dialog(selected_collection.get())
        
        Button(collection_window, text="确定", command=on_select).pack(pady=10)
    
    def _create_volume_dialog(self, collection_name):
        """创建分卷对话框"""
        volume_name = simpledialog.askstring("创建分卷", f"请为小说集 '{collection_name}' 输入分卷名称：")
        if not volume_name:
            return
        
        # 检查名称是否合法
        if not self.is_valid_name(volume_name):
            messagebox.showerror("错误", "名称包含非法字符")
            return
        
        volume_path = os.path.join(CONFIG['content_dir'], collection_name, volume_name)
        
        # 检查目录是否已存在
        if os.path.exists(volume_path):
            messagebox.showerror("错误", "分卷已存在")
            return
        
        try:
            # 创建目录
            os.makedirs(volume_path)
            
            # 创建_index.md文件
            index_file = os.path.join(volume_path, "_index.md")
            with open(index_file, 'w', encoding='utf-8') as f:
                f.write(f"---\ntitle: \"{volume_name}\"\ndate: {datetime.now().strftime('%Y-%m-%dT%H:%M:%S+08:00')}\ndraft: false\n---\n\n# {volume_name}\n\n分卷简介")
            
            messagebox.showinfo("成功", f"分卷 '{volume_name}' 创建成功")
            self.update_structure_view()
            
            # 自动备份
            if CONFIG['auto_backup_enabled']:
                self.perform_backup(f"创建分卷: {volume_name}")
        except Exception as e:
            messagebox.showerror("错误", f"创建分卷失败: {str(e)}")
    
    def create_chapter(self):
        """创建新的章节"""
        # 获取小说集和分卷列表
        collection_volume_map = {}
        if os.path.exists(CONFIG['content_dir']):
            for collection in os.listdir(CONFIG['content_dir']):
                collection_path = os.path.join(CONFIG['content_dir'], collection)
                if os.path.isdir(collection_path):
                    volumes = []
                    for volume in os.listdir(collection_path):
                        volume_path = os.path.join(collection_path, volume)
                        if os.path.isdir(volume_path):
                            volumes.append(volume)
                    if volumes:
                        collection_volume_map[collection] = volumes
        
        if not collection_volume_map:
            messagebox.showerror("错误", "请先创建小说集和分卷")
            return
        
        # 选择小说集和分卷
        selection_window = Tk()
        selection_window.title("选择小说集和分卷")
        selection_window.geometry("400x300")
        
        # 小说集选择
        Label(selection_window, text="小说集：").grid(row=0, column=0, sticky=tk.W, padx=10, pady=10)
        collection_var = tk.StringVar(value=list(collection_volume_map.keys())[0])
        collection_menu = ttk.Combobox(selection_window, textvariable=collection_var, state="readonly", width=20)
        collection_menu['values'] = list(collection_volume_map.keys())
        collection_menu.grid(row=0, column=1, padx=10, pady=10)
        
        # 分卷选择
        Label(selection_window, text="分卷：").grid(row=1, column=0, sticky=tk.W, padx=10, pady=10)
        volume_var = tk.StringVar()
        volume_menu = ttk.Combobox(selection_window, textvariable=volume_var, state="readonly", width=20)
        volume_menu['values'] = collection_volume_map[collection_var.get()]
        volume_menu.current(0)
        volume_menu.grid(row=1, column=1, padx=10, pady=10)
        
        # 当小说集改变时，更新分卷列表
        def on_collection_change(event):
            volume_menu['values'] = collection_volume_map[collection_var.get()]
            volume_menu.current(0)
        
        collection_menu.bind("<<ComboboxSelected>>", on_collection_change)
        
        def on_confirm():
            collection_name = collection_var.get()
            volume_name = volume_var.get()
            selection_window.destroy()
            self._create_chapter_dialog(collection_name, volume_name)
        
        Button(selection_window, text="确定", command=on_confirm).grid(row=2, column=0, columnspan=2, pady=20)
    
    def _create_chapter_dialog(self, collection_name, volume_name):
        """创建章节对话框"""
        chapter_window = Tk()
        chapter_window.title("创建章节")
        chapter_window.geometry("400x300")
        
        # 章节标题
        Label(chapter_window, text="章节标题：").grid(row=0, column=0, sticky=tk.W, padx=10, pady=10)
        title_entry = Entry(chapter_window, width=30)
        title_entry.grid(row=0, column=1, padx=10, pady=10)
        
        # 章节编号
        Label(chapter_window, text="章节编号：").grid(row=1, column=0, sticky=tk.W, padx=10, pady=10)
        # 获取当前最大章节编号
        volume_path = os.path.join(CONFIG['content_dir'], collection_name, volume_name)
        max_chapter_num = 0
        if os.path.exists(volume_path):
            for item in os.listdir(volume_path):
                if item.startswith('chapter') and item.endswith('.md'):
                    try:
                        num = int(item[7:-3])  # 提取chapter后面的数字
                        if num > max_chapter_num:
                            max_chapter_num = num
                    except:
                        pass
        
        chapter_num_var = tk.StringVar(value=str(max_chapter_num + 1))
        num_entry = Entry(chapter_window, textvariable=chapter_num_var, width=10)
        num_entry.grid(row=1, column=1, padx=10, pady=10, sticky=tk.W)
        
        # 是否立即编辑
        edit_var = BooleanVar(value=True)
        Checkbutton(chapter_window, text="创建后立即编辑", variable=edit_var).grid(row=2, column=0, columnspan=2, padx=10, pady=10)
        
        def on_create():
            title = title_entry.get().strip()
            try:
                chapter_num = int(chapter_num_var.get())
            except:
                messagebox.showerror("错误", "章节编号必须是数字")
                return
            
            if not title:
                messagebox.showerror("错误", "章节标题不能为空")
                return
            
            # 生成文件名
            filename = f"chapter{chapter_num}.md"
            file_path = os.path.join(volume_path, filename)
            
            # 检查文件是否已存在
            if os.path.exists(file_path):
                messagebox.showerror("错误", f"章节文件 '{filename}' 已存在")
                return
            
            try:
                # 创建章节文件
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(f"---\ntitle: \"{title}\"\ndate: {datetime.now().strftime('%Y-%m-%dT%H:%M:%S+08:00')}\ndraft: false\n---\n\n{title}\n\n正文内容")
                
                messagebox.showinfo("成功", f"章节 '{title}' 创建成功")
                
                # 自动备份
                if CONFIG['auto_backup_enabled']:
                    self.perform_backup(f"创建章节: {title}")
                
                # 立即编辑
                if edit_var.get():
                    try:
                        subprocess.Popen([CONFIG['editor'], file_path])
                    except:
                        messagebox.showwarning("警告", "无法打开编辑器，请手动编辑文件")
                
                chapter_window.destroy()
                self.update_structure_view()
            except Exception as e:
                messagebox.showerror("错误", f"创建章节失败: {str(e)}")
        
        Button(chapter_window, text="创建章节", command=on_create).grid(row=3, column=0, columnspan=2, pady=20)
    
    def browse_content(self):
        """浏览内容目录"""
        try:
            if os.path.exists(CONFIG['content_dir']):
                # 在Windows上打开资源管理器
                if sys.platform.startswith('win'):
                    os.startfile(os.path.abspath(CONFIG['content_dir']))
                else:
                    # 在其他系统上使用默认文件管理器
                    subprocess.Popen(['xdg-open', os.path.abspath(CONFIG['content_dir'])])
            else:
                messagebox.showerror("错误", "内容目录不存在")
        except Exception as e:
            messagebox.showerror("错误", f"打开目录失败: {str(e)}")
    
    def start_preview(self):
        """启动Hugo预览服务器"""
        try:
            # 检查hugo.exe是否存在
            hugo_exe = os.path.join("..", "hugo.exe")
            if not os.path.exists(hugo_exe):
                hugo_exe = "hugo"  # 尝试使用系统路径中的hugo
            
            # 启动预览服务器
            subprocess.Popen([hugo_exe, "server", "-D", "--disableFastRender"], cwd=os.getcwd())
            messagebox.showinfo("成功", "预览服务器已启动\n请访问 http://localhost:1313/")
        except Exception as e:
            messagebox.showerror("错误", f"启动预览服务器失败: {str(e)}")
    
    def init_convert_tab(self):
        """初始化转换工具标签页"""
        Label(self.convert_tab, text="文档格式转换工具", font=("SimHei", 16)).pack(pady=20)
        
        # 源文件选择
        frame1 = Frame(self.convert_tab)
        frame1.pack(fill=tk.X, padx=20, pady=10)
        
        Label(frame1, text="源文件：", width=10).pack(side=tk.LEFT)
        self.source_file_var = tk.StringVar()
        Entry(frame1, textvariable=self.source_file_var, width=50).pack(side=tk.LEFT, fill=tk.X, expand=True, padx=10)
        Button(frame1, text="浏览", command=self.browse_source_file).pack(side=tk.RIGHT)
        
        # 目标目录选择
        frame2 = Frame(self.convert_tab)
        frame2.pack(fill=tk.X, padx=20, pady=10)
        
        Label(frame2, text="目标目录：", width=10).pack(side=tk.LEFT)
        self.target_dir_var = tk.StringVar(value=CONFIG['content_dir'])
        Entry(frame2, textvariable=self.target_dir_var, width=50).pack(side=tk.LEFT, fill=tk.X, expand=True, padx=10)
        Button(frame2, text="浏览", command=self.browse_target_dir).pack(side=tk.RIGHT)
        
        # 选项
        frame3 = Frame(self.convert_tab)
        frame3.pack(fill=tk.X, padx=20, pady=10)
        
        Label(frame3, text="选项：", width=10).pack(side=tk.LEFT)
        self.add_front_matter_var = BooleanVar(value=True)
        Checkbutton(frame3, text="添加Front Matter", variable=self.add_front_matter_var).pack(side=tk.LEFT, padx=10)
        
        # 转换按钮
        Button(self.convert_tab, text="开始转换", command=self.convert_document, font=("SimHei", 12), pady=5).pack(pady=20)
        
        # 转换日志
        Label(self.convert_tab, text="转换日志：").pack(padx=20, anchor=tk.W)
        self.convert_log = tk.Text(self.convert_tab, wrap=tk.WORD, height=10)
        self.convert_log.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)
    
    def browse_source_file(self):
        """浏览源文件"""
        file_types = [
            ("Word文档", "*.docx;*.doc"),
            ("WPS文档", "*.wps;*.et;*.dps"),
            ("所有文件", "*.*")
        ]
        file_path = filedialog.askopenfilename(title="选择源文件", filetypes=file_types)
        if file_path:
            self.source_file_var.set(file_path)
    
    def browse_target_dir(self):
        """浏览目标目录"""
        dir_path = filedialog.askdirectory(title="选择目标目录", initialdir=CONFIG['content_dir'])
        if dir_path:
            self.target_dir_var.set(dir_path)
    
    def convert_document(self):
        """转换文档格式"""
        source_file = self.source_file_var.get()
        target_dir = self.target_dir_var.get()
        
        if not source_file:
            messagebox.showerror("错误", "请选择源文件")
            return
        
        if not os.path.exists(source_file):
            messagebox.showerror("错误", "源文件不存在")
            return
        
        if not target_dir:
            messagebox.showerror("错误", "请选择目标目录")
            return
        
        if not os.path.exists(target_dir):
            try:
                os.makedirs(target_dir)
            except:
                messagebox.showerror("错误", "创建目标目录失败")
                return
        
        try:
            self.convert_log.delete(1.0, tk.END)
            self.convert_log.insert(tk.END, f"开始转换文件：{source_file}\n")
            
            # 获取文件名（不含扩展名）
            base_name = os.path.splitext(os.path.basename(source_file))[0]
            target_file = os.path.join(target_dir, f"{base_name}.md")
            
            # 这里使用pandoc进行转换（需要用户安装pandoc）
            # 如果没有pandoc，提供手动转换指南
            try:
                # 尝试使用pandoc转换
                subprocess.run(["pandoc", source_file, "-o", target_file], check=True)
                self.convert_log.insert(tk.END, f"转换成功：{target_file}\n")
                
                # 添加Front Matter
                if self.add_front_matter_var.get():
                    with open(target_file, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    front_matter = f"---\ntitle: \"{base_name}\"\ndate: {datetime.now().strftime('%Y-%m-%dT%H:%M:%S+08:00')}\ndraft: false\n---\n\n"
                    
                    with open(target_file, 'w', encoding='utf-8') as f:
                        f.write(front_matter + content)
                    
                    self.convert_log.insert(tk.END, "已添加Front Matter\n")
                
                messagebox.showinfo("成功", "文档转换成功")
                
                # 自动备份
                if CONFIG['auto_backup_enabled']:
                    self.perform_backup(f"转换文档: {base_name}")
                
            except FileNotFoundError:
                self.convert_log.insert(tk.END, "错误：未找到pandoc工具\n")
                self.convert_log.insert(tk.END, "请手动转换文档或安装pandoc\n")
                self.convert_log.insert(tk.END, "pandoc下载地址：https://pandoc.org/installing.html\n")
                messagebox.showwarning("警告", "未找到pandoc工具，请手动转换或安装pandoc")
            except Exception as e:
                self.convert_log.insert(tk.END, f"转换失败：{str(e)}\n")
                messagebox.showerror("错误", f"转换失败：{str(e)}")
        except Exception as e:
            self.convert_log.insert(tk.END, f"处理失败：{str(e)}\n")
            messagebox.showerror("错误", f"处理失败：{str(e)}")
    
    def init_config_tab(self):
        """初始化配置标签页"""
        Label(self.config_tab, text="工具配置", font=("SimHei", 16)).pack(pady=20)
        
        # 内容目录
        frame1 = Frame(self.config_tab)
        frame1.pack(fill=tk.X, padx=20, pady=10)
        
        Label(frame1, text="内容目录：", width=15).pack(side=tk.LEFT)
        self.content_dir_entry = Entry(frame1, width=50)
        self.content_dir_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=10)
        self.content_dir_entry.insert(0, CONFIG['content_dir'])
        Button(frame1, text="浏览", command=lambda: self.browse_dir(self.content_dir_entry)).pack(side=tk.RIGHT)
        
        # 备份目录
        frame2 = Frame(self.config_tab)
        frame2.pack(fill=tk.X, padx=20, pady=10)
        
        Label(frame2, text="备份目录：", width=15).pack(side=tk.LEFT)
        self.backup_dir_entry = Entry(frame2, width=50)
        self.backup_dir_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=10)
        self.backup_dir_entry.insert(0, CONFIG['backup_dir'])
        Button(frame2, text="浏览", command=lambda: self.browse_dir(self.backup_dir_entry)).pack(side=tk.RIGHT)
        
        # 编辑器
        frame3 = Frame(self.config_tab)
        frame3.pack(fill=tk.X, padx=20, pady=10)
        
        Label(frame3, text="默认编辑器：", width=15).pack(side=tk.LEFT)
        self.editor_entry = Entry(frame3, width=50)
        self.editor_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=10)
        self.editor_entry.insert(0, CONFIG['editor'])
        Button(frame3, text="浏览", command=lambda: self.browse_file(self.editor_entry)).pack(side=tk.RIGHT)
        
        # 自动备份
        frame4 = Frame(self.config_tab)
        frame4.pack(fill=tk.X, padx=20, pady=10)
        
        self.auto_backup_var = BooleanVar(value=CONFIG['auto_backup_enabled'])
        Checkbutton(frame4, text="启用自动备份", variable=self.auto_backup_var).pack(anchor=tk.W)
        
        # 保存按钮
        Button(self.config_tab, text="保存配置", command=self.save_config_to_memory, font=("SimHei", 12), pady=5).pack(pady=20)
    
    def browse_dir(self, entry):
        """浏览目录并更新输入框"""
        dir_path = filedialog.askdirectory()
        if dir_path:
            entry.delete(0, tk.END)
            entry.insert(0, dir_path)
    
    def browse_file(self, entry):
        """浏览文件并更新输入框"""
        file_path = filedialog.askopenfilename()
        if file_path:
            entry.delete(0, tk.END)
            entry.insert(0, file_path)
    
    def save_config_to_memory(self):
        """保存配置到内存"""
        CONFIG['content_dir'] = self.content_dir_entry.get()
        CONFIG['backup_dir'] = self.backup_dir_entry.get()
        CONFIG['editor'] = self.editor_entry.get()
        CONFIG['auto_backup_enabled'] = self.auto_backup_var.get()
        
        # 保存到文件
        self.save_config()
        
        # 更新视图
        self.update_structure_view()
    
    def init_backup_tab(self):
        """初始化备份管理标签页"""
        Label(self.backup_tab, text="备份管理", font=("SimHei", 16)).pack(pady=20)
        
        # 备份按钮
        Button(self.backup_tab, text="立即备份", command=self.perform_backup, font=("SimHei", 12), pady=5).pack(pady=10)
        
        # 备份列表
        Label(self.backup_tab, text="备份列表：").pack(padx=20, anchor=tk.W)
        
        # 备份列表框架
        list_frame = Frame(self.backup_tab)
        list_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)
        
        # 创建Treeview组件
        columns = ("name", "date", "size")
        self.backup_tree = ttk.Treeview(list_frame, columns=columns, show="headings")
        
        # 设置列宽和标题
        self.backup_tree.column("name", width=200, anchor=tk.W)
        self.backup_tree.column("date", width=150, anchor=tk.CENTER)
        self.backup_tree.column("size", width=100, anchor=tk.RIGHT)
        
        self.backup_tree.heading("name", text="备份名称")
        self.backup_tree.heading("date", text="备份时间")
        self.backup_tree.heading("size", text="大小")
        
        # 添加滚动条
        scrollbar = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.backup_tree.yview)
        self.backup_tree.configure(yscroll=scrollbar.set)
        
        # 布局
        self.backup_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # 操作按钮
        button_frame = Frame(self.backup_tab)
        button_frame.pack(fill=tk.X, padx=20, pady=10)
        
        Button(button_frame, text="恢复备份", command=self.restore_backup).pack(side=tk.LEFT, padx=5)
        Button(button_frame, text="删除备份", command=self.delete_backup).pack(side=tk.LEFT, padx=5)
        Button(button_frame, text="刷新列表", command=self.refresh_backup_list).pack(side=tk.LEFT, padx=5)
        
        # 刷新备份列表
        self.refresh_backup_list()
    
    def refresh_backup_list(self):
        """刷新备份列表"""
        # 清空现有列表
        for item in self.backup_tree.get_children():
            self.backup_tree.delete(item)
        
        try:
            if not os.path.exists(CONFIG['backup_dir']):
                os.makedirs(CONFIG['backup_dir'])
                return
            
            # 获取备份文件列表
            backups = []
            for item in os.listdir(CONFIG['backup_dir']):
                item_path = os.path.join(CONFIG['backup_dir'], item)
                if os.path.isfile(item_path) and item.endswith('.zip'):
                    # 获取文件信息
                    stats = os.stat(item_path)
                    file_size = stats.st_size // 1024  # KB
                    mod_time = datetime.fromtimestamp(stats.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
                    backups.append((item, mod_time, f"{file_size} KB", item_path))
            
            # 按修改时间排序（最新的在前）
            backups.sort(key=lambda x: x[1], reverse=True)
            
            # 添加到列表
            for backup in backups:
                self.backup_tree.insert('', tk.END, values=(backup[0], backup[1], backup[2]), tags=(backup[3],))
        except Exception as e:
            messagebox.showerror("错误", f"刷新备份列表失败: {str(e)}")
    
    def perform_backup(self, reason="手动备份"):
        """执行备份操作"""
        try:
            # 检查备份目录
            if not os.path.exists(CONFIG['backup_dir']):
                os.makedirs(CONFIG['backup_dir'])
            
            # 生成备份文件名
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            reason_safe = "_".join(reason.split())[:20]  # 安全的原因文本
            backup_file = os.path.join(CONFIG['backup_dir'], f"backup_{timestamp}_{reason_safe}.zip")
            
            # 使用zipfile模块创建备份
            import zipfile
            
            # 要备份的目录
            dirs_to_backup = [CONFIG['content_dir'], 'layouts', 'config.yaml', 'archetypes']
            
            with zipfile.ZipFile(backup_file, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for dir_path in dirs_to_backup:
                    if os.path.isdir(dir_path):
                        # 遍历目录
                        for root, _, files in os.walk(dir_path):
                            for file in files:
                                file_path = os.path.join(root, file)
                                # 计算相对路径
                                rel_path = os.path.relpath(file_path, os.getcwd())
                                zipf.write(file_path, rel_path)
                    elif os.path.isfile(dir_path):
                        # 备份单个文件
                        zipf.write(dir_path, os.path.basename(dir_path))
            
            messagebox.showinfo("成功", f"备份成功：{backup_file}")
            self.refresh_backup_list()
        except Exception as e:
            messagebox.showerror("错误", f"备份失败: {str(e)}")
    
    def restore_backup(self):
        """恢复备份"""
        selected_item = self.backup_tree.selection()
        if not selected_item:
            messagebox.showwarning("警告", "请先选择要恢复的备份")
            return
        
        # 获取备份文件路径
        backup_path = self.backup_tree.item(selected_item[0], "tags")[0]
        
        # 确认恢复
        if not messagebox.askyesno("确认恢复", f"确定要恢复备份吗？这将覆盖现有内容！\n\n备份文件：{os.path.basename(backup_path)}"):
            return
        
        try:
            import zipfile
            
            # 解压缩备份文件到当前目录
            with zipfile.ZipFile(backup_path, 'r') as zipf:
                zipf.extractall(os.getcwd())
            
            messagebox.showinfo("成功", "备份恢复成功")
            self.update_structure_view()
        except Exception as e:
            messagebox.showerror("错误", f"恢复备份失败: {str(e)}")
    
    def delete_backup(self):
        """删除备份"""
        selected_item = self.backup_tree.selection()
        if not selected_item:
            messagebox.showwarning("警告", "请先选择要删除的备份")
            return
        
        # 获取备份文件路径
        backup_path = self.backup_tree.item(selected_item[0], "tags")[0]
        
        # 确认删除
        if not messagebox.askyesno("确认删除", f"确定要删除此备份吗？\n\n备份文件：{os.path.basename(backup_path)}"):
            return
        
        try:
            os.remove(backup_path)
            messagebox.showinfo("成功", "备份删除成功")
            self.refresh_backup_list()
        except Exception as e:
            messagebox.showerror("错误", f"删除备份失败: {str(e)}")
    
    def is_valid_name(self, name):
        """检查名称是否合法"""
        invalid_chars = '<>:"/\\|?*'
        for char in invalid_chars:
            if char in name:
                return False
        return True

if __name__ == "__main__":
    # 创建根窗口
    root = Tk()
    # 设置中文字体支持
    root.option_add("*Font", "SimHei 10")
    # 创建应用实例
    app = NovelManager(root)
    # 启动主循环
    root.mainloop()