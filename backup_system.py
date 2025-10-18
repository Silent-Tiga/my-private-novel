#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
小说网站自动备份系统
功能：定期备份网站内容，支持版本控制和备份恢复
"""

import os
import sys
import shutil
import time
import datetime
import json
import zipfile
import logging
import argparse
from pathlib import Path
import schedule

# 配置
CONFIG = {
    'backup_dir': os.path.join(os.path.dirname(__file__), 'backups'),  # 备份存储目录
    'content_dir': os.path.join(os.path.dirname(__file__), 'content'),  # 内容目录
    'config_files': [  # 需要备份的配置文件
        os.path.join(os.path.dirname(__file__), 'config.yaml'),
        os.path.join(os.path.dirname(__file__), 'netlify.toml')
    ],
    'log_file': os.path.join(os.path.dirname(__file__), 'backup.log'),  # 日志文件
    'max_backups': 30,  # 最大备份数量
    'backup_interval': 24,  # 备份间隔（小时）
    'compress': True,  # 是否压缩备份文件
    'exclude_patterns': [  # 排除的文件/目录模式
        '.git',
        '__pycache__',
        '*.pyc',
        '*.log',
        'backups'
    ]
}

# 初始化日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(CONFIG['log_file']),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('backup_system')


def setup_backup_dir():
    """创建备份目录"""
    if not os.path.exists(CONFIG['backup_dir']):
        os.makedirs(CONFIG['backup_dir'])
        logger.info(f"创建备份目录: {CONFIG['backup_dir']}")


def get_backup_filename():
    """生成备份文件名"""
    timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    return f'backup_{timestamp}'


def should_exclude(path):
    """检查路径是否应该被排除"""
    for pattern in CONFIG['exclude_patterns']:
        if pattern in path:
            return True
    return False


def create_backup(description="自动备份"):
    """创建备份"""
    try:
        setup_backup_dir()
        
        # 生成备份文件名
        backup_name = get_backup_filename()
        backup_path = os.path.join(CONFIG['backup_dir'], backup_name)
        
        # 创建备份元数据
        metadata = {
            'name': backup_name,
            'timestamp': time.time(),
            'datetime': datetime.datetime.now().isoformat(),
            'description': description,
            'content_size': 0,
            'file_count': 0
        }
        
        # 记录开始时间
        start_time = time.time()
        logger.info(f"开始创建备份: {backup_name}")
        
        if CONFIG['compress']:
            # 创建压缩文件
            zip_path = f"{backup_path}.zip"
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                # 备份内容目录
                for root, dirs, files in os.walk(CONFIG['content_dir']):
                    # 过滤排除的目录
                    dirs[:] = [d for d in dirs if not should_exclude(os.path.join(root, d))]
                    
                    for file in files:
                        file_path = os.path.join(root, file)
                        if should_exclude(file_path):
                            continue
                        
                        # 计算相对路径，保持目录结构
                        rel_path = os.path.relpath(file_path, os.path.dirname(__file__))
                        zipf.write(file_path, rel_path)
                        metadata['file_count'] += 1
                        metadata['content_size'] += os.path.getsize(file_path)
                
                # 备份配置文件
                for config_file in CONFIG['config_files']:
                    if os.path.exists(config_file):
                        rel_path = os.path.relpath(config_file, os.path.dirname(__file__))
                        zipf.write(config_file, rel_path)
                        metadata['file_count'] += 1
                        metadata['content_size'] += os.path.getsize(config_file)
            
            # 保存元数据
            metadata_path = f"{backup_path}_metadata.json"
            with open(metadata_path, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)
            
            backup_size = os.path.getsize(zip_path)
        else:
            # 创建非压缩备份（复制目录）
            shutil.copytree(CONFIG['content_dir'], os.path.join(backup_path, 'content'))
            
            # 复制配置文件
            os.makedirs(os.path.join(backup_path, 'config'), exist_ok=True)
            for config_file in CONFIG['config_files']:
                if os.path.exists(config_file):
                    shutil.copy2(config_file, os.path.join(backup_path, 'config'))
            
            # 保存元数据
            metadata_path = os.path.join(backup_path, 'metadata.json')
            with open(metadata_path, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)
            
            # 计算备份大小
            backup_size = 0
            for root, dirs, files in os.walk(backup_path):
                for file in files:
                    backup_size += os.path.getsize(os.path.join(root, file))
        
        # 记录结束时间
        end_time = time.time()
        duration = end_time - start_time
        
        logger.info(f"备份完成: {backup_name}")
        logger.info(f"  - 描述: {description}")
        logger.info(f"  - 文件数: {metadata['file_count']}")
        logger.info(f"  - 内容大小: {metadata['content_size']/1024/1024:.2f} MB")
        logger.info(f"  - 备份大小: {backup_size/1024/1024:.2f} MB")
        logger.info(f"  - 耗时: {duration:.2f} 秒")
        
        # 清理旧备份
        cleanup_old_backups()
        
        return backup_name
        
    except Exception as e:
        logger.error(f"创建备份失败: {str(e)}")
        raise


def list_backups():
    """列出所有备份"""
    backups = []
    
    if not os.path.exists(CONFIG['backup_dir']):
        logger.info("没有找到备份目录")
        return backups
    
    # 遍历备份目录
    for item in os.listdir(CONFIG['backup_dir']):
        item_path = os.path.join(CONFIG['backup_dir'], item)
        
        # 处理压缩备份
        if item.endswith('.zip'):
            backup_name = item[:-4]  # 移除.zip扩展名
            metadata_file = f"{backup_name}_metadata.json"
            metadata_path = os.path.join(CONFIG['backup_dir'], metadata_file)
            
            if os.path.exists(metadata_path):
                try:
                    with open(metadata_path, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)
                    
                    backup_info = {
                        'name': backup_name,
                        'type': 'compressed',
                        'path': item_path,
                        'metadata': metadata,
                        'size': os.path.getsize(item_path)
                    }
                    backups.append(backup_info)
                except Exception as e:
                    logger.warning(f"读取备份元数据失败: {metadata_file}, 错误: {str(e)}")
        
        # 处理非压缩备份（目录）
        elif os.path.isdir(item_path):
            metadata_path = os.path.join(item_path, 'metadata.json')
            
            if os.path.exists(metadata_path):
                try:
                    with open(metadata_path, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)
                    
                    # 计算目录大小
                    dir_size = 0
                    for root, dirs, files in os.walk(item_path):
                        for file in files:
                            dir_size += os.path.getsize(os.path.join(root, file))
                    
                    backup_info = {
                        'name': item,
                        'type': 'directory',
                        'path': item_path,
                        'metadata': metadata,
                        'size': dir_size
                    }
                    backups.append(backup_info)
                except Exception as e:
                    logger.warning(f"读取备份元数据失败: {metadata_path}, 错误: {str(e)}")
    
    # 按时间戳排序（最新的在前）
    backups.sort(key=lambda x: x['metadata']['timestamp'], reverse=True)
    
    return backups


def restore_backup(backup_name):
    """恢复备份"""
    try:
        logger.info(f"开始恢复备份: {backup_name}")
        
        # 获取备份信息
        backups = list_backups()
        backup_info = next((b for b in backups if b['name'] == backup_name), None)
        
        if not backup_info:
            raise ValueError(f"未找到备份: {backup_name}")
        
        # 确认操作
        confirm = input(f"确定要恢复备份 '{backup_name}' 吗？这将覆盖当前内容！(y/n): ")
        if confirm.lower() != 'y':
            logger.info("恢复操作已取消")
            return False
        
        # 记录开始时间
        start_time = time.time()
        
        # 创建临时目录
        temp_dir = os.path.join(CONFIG['backup_dir'], f'temp_restore_{int(time.time())}')
        os.makedirs(temp_dir, exist_ok=True)
        
        try:
            # 解压缩备份文件
            if backup_info['type'] == 'compressed':
                with zipfile.ZipFile(backup_info['path'], 'r') as zipf:
                    zipf.extractall(temp_dir)
            else:
                # 对于目录备份，直接使用
                shutil.copytree(backup_info['path'], temp_dir, dirs_exist_ok=True)
            
            # 备份当前内容
            current_backup_name = f"pre_restore_{get_backup_filename()}"
            current_backup_path = os.path.join(CONFIG['backup_dir'], current_backup_name)
            
            if os.path.exists(CONFIG['content_dir']):
                shutil.copytree(CONFIG['content_dir'], current_backup_path)
                logger.info(f"已创建恢复前备份: {current_backup_name}")
            
            # 恢复内容目录
            content_backup_path = os.path.join(temp_dir, 'content')
            if os.path.exists(content_backup_path):
                # 移除当前内容目录
                if os.path.exists(CONFIG['content_dir']):
                    shutil.rmtree(CONFIG['content_dir'])
                # 恢复备份的内容目录
                shutil.copytree(content_backup_path, CONFIG['content_dir'])
            
            # 恢复配置文件
            config_backup_path = os.path.join(temp_dir, 'config')
            if os.path.exists(config_backup_path):
                for config_file in CONFIG['config_files']:
                    config_filename = os.path.basename(config_file)
                    backup_config_file = os.path.join(config_backup_path, config_filename)
                    if os.path.exists(backup_config_file):
                        shutil.copy2(backup_config_file, config_file)
            
            # 记录结束时间
            end_time = time.time()
            duration = end_time - start_time
            
            logger.info(f"备份恢复完成: {backup_name}")
            logger.info(f"  - 耗时: {duration:.2f} 秒")
            logger.info(f"  - 已恢复内容目录: {CONFIG['content_dir']}")
            
            return True
            
        finally:
            # 清理临时目录
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
                
    except Exception as e:
        logger.error(f"恢复备份失败: {str(e)}")
        raise


def cleanup_old_backups():
    """清理旧备份，保留指定数量的最新备份"""
    try:
        backups = list_backups()
        
        if len(backups) <= CONFIG['max_backups']:
            return
        
        # 计算需要删除的备份数量
        backups_to_delete = len(backups) - CONFIG['max_backups']
        
        # 获取需要删除的旧备份
        old_backups = backups[-backups_to_delete:]
        
        logger.info(f"开始清理旧备份，共需删除 {len(old_backups)} 个备份")
        
        for backup in old_backups:
            try:
                if backup['type'] == 'compressed':
                    # 删除压缩文件和元数据文件
                    os.remove(backup['path'])
                    metadata_file = f"{backup['name']}_metadata.json"
                    metadata_path = os.path.join(CONFIG['backup_dir'], metadata_file)
                    if os.path.exists(metadata_path):
                        os.remove(metadata_path)
                else:
                    # 删除目录备份
                    shutil.rmtree(backup['path'])
                
                logger.info(f"已删除旧备份: {backup['name']}")
                
            except Exception as e:
                logger.error(f"删除备份失败: {backup['name']}, 错误: {str(e)}")
                
    except Exception as e:
        logger.error(f"清理旧备份失败: {str(e)}")


def run_scheduled_backup():
    """执行定期备份任务"""
    try:
        create_backup("定期自动备份")
    except Exception as e:
        logger.error(f"定期备份任务执行失败: {str(e)}")


def start_scheduler():
    """启动备份调度器"""
    logger.info(f"启动自动备份调度器，每 {CONFIG['backup_interval']} 小时执行一次备份")
    
    # 立即执行一次备份
    run_scheduled_backup()
    
    # 设置定期任务
    schedule.every(CONFIG['backup_interval']).hours.do(run_scheduled_backup)
    
    # 循环执行任务
    try:
        while True:
            schedule.run_pending()
            time.sleep(60)  # 每分钟检查一次
    except KeyboardInterrupt:
        logger.info("自动备份调度器已停止")


def display_backups_table(backups):
    """以表格形式显示备份列表"""
    if not backups:
        print("没有找到备份")
        return
    
    # 定义表格宽度
    max_name = max(len(b['name']) for b in backups) + 2
    max_date = max(len(b['metadata']['datetime'][:19]) for b in backups) + 2
    max_size = 12
    max_files = 10
    
    # 打印表头
    print("=" * (max_name + max_date + max_size + max_files + 36))
    print(f"{'备份名称':<{max_name}} {'日期时间':<{max_date}} {'大小':<{max_size}} {'文件数':<{max_files}} {'描述'}")
    print("=" * (max_name + max_date + max_size + max_files + 36))
    
    # 打印每个备份
    for backup in backups:
        name = backup['name']
        date_time = backup['metadata']['datetime'][:19]  # 截取日期时间部分
        size_mb = backup['size'] / 1024 / 1024
        files = backup['metadata'].get('file_count', 0)
        description = backup['metadata'].get('description', '')
        
        print(f"{name:<{max_name}} {date_time:<{max_date}} {size_mb:,.2f} MB  {files:<{max_files}} {description}")
    
    print("=" * (max_name + max_date + max_size + max_files + 36))


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='小说网站自动备份系统')
    parser.add_argument('--create', action='store_true', help='创建备份')
    parser.add_argument('--list', action='store_true', help='列出所有备份')
    parser.add_argument('--restore', type=str, help='恢复指定备份')
    parser.add_argument('--cleanup', action='store_true', help='清理旧备份')
    parser.add_argument('--start', action='store_true', help='启动自动备份调度器')
    parser.add_argument('--description', type=str, default='手动备份', help='备份描述')
    
    args = parser.parse_args()
    
    if args.create:
        # 创建备份
        create_backup(args.description)
        
    elif args.list:
        # 列出备份
        backups = list_backups()
        display_backups_table(backups)
        
    elif args.restore:
        # 恢复备份
        restore_backup(args.restore)
        
    elif args.cleanup:
        # 清理旧备份
        cleanup_old_backups()
        
    elif args.start:
        # 启动调度器
        start_scheduler()
        
    else:
        # 显示帮助信息
        parser.print_help()


if __name__ == '__main__':
    main()