#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// 当前时间，格式化为 YYYY-MM-DD HH:MM:SS
const currentDateTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

// 获取命令行参数
const args = process.argv.slice(2);
if (args.length < 1) {
    console.error('用法: node batch-publish.js <tgz目录> [registry地址]');
    process.exit(1);
}

const tgzDir = path.resolve(args[0]);
const registry = args[1] || 'http://127.0.0.1:4873'; // 默认本地私服
const logFile = 'publish-log.txt';

// 清空或创建日志文件
fs.writeFileSync(logFile, `批量发布开始 - ${currentDateTime}\n用户: ${process.env.USER || 'moselikk'}\n注册表: ${registry}\n\n`, 'utf8');

// 记录日志的函数
function log(message, toConsole = true) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, logMessage, 'utf8');
    if (toConsole) {
        console.log(message);
    }
}

// 从tgz文件名中提取包名和版本
function extractPackageInfo(tgzFileName) {
    // 移除.tgz后缀
    const baseName = tgzFileName.replace(/\.tgz$/, '');

    // 匹配版本号
    const versionMatch = baseName.match(/-(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)$/);
    if (!versionMatch) {
        return null;
    }

    const version = versionMatch[1];
    // 包名是版本号之前的所有内容
    const nameWithHyphen = baseName.substring(0, baseName.length - version.length - 1);

    // 处理@scope/package-name格式
    let name = nameWithHyphen;
    if (nameWithHyphen.includes('-')) {
        // 可能是@scope/package-name格式转换成的scope-package-name
        // 检查是否是scope包
        const parts = nameWithHyphen.split('-');
        if (parts.length >= 2 && !parts[0].includes('.')) {
            // 假设第一个分段是scope，尝试恢复@scope/package-name格式
            name = `@${parts[0]}/${parts.slice(1).join('-')}`;
        }
    }

    return { name, version };
}

// 检查包是否已发布
async function isPackagePublished(packageName, version, registry) {
    try {
        const command = `npm view ${packageName}@${version} version --registry=${registry}`;
        const { stdout } = await execPromise(command, { stdio: ['pipe', 'pipe', 'ignore'] });
        return stdout.trim() === version;
    } catch (error) {
        // npm view 命令返回非零状态码表示包不存在
        return false;
    }
}

// 主函数
async function main() {
    if (!fs.existsSync(tgzDir)) {
        log(`❌ 错误: 目录不存在: ${tgzDir}`);
        process.exit(1);
    }

    // 读取目录下所有 .tgz 文件
    const files = fs.readdirSync(tgzDir).filter(file => file.endsWith('.tgz'));

    if (files.length === 0) {
        log('⚠️ 警告: 没有找到任何 .tgz 文件。');
        process.exit(0);
    }

    log(`🚀 准备发布 ${files.length} 个包到 ${registry}`);
    log('--------------------------------------------------');

    // 统计数据
    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;

    // 逐个处理包
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filePath = path.join(tgzDir, file);
        const progress = `[${i + 1}/${files.length}]`;

        // 提取包信息
        const packageInfo = extractPackageInfo(file);
        if (!packageInfo) {
            log(`${progress} ❓ 无法解析包信息: ${file}`);
            failureCount++;
            continue;
        }

        const { name, version } = packageInfo;
        log(`${progress} 处理: ${name}@${version}`);

        // 检查包是否已发布
        try {
            const isPublished = await isPackagePublished(name, version, registry);
            if (isPublished) {
                log(`${progress} ⏩ 跳过: ${name}@${version} - 该版本已存在`);
                skippedCount++;
                continue;
            }

            // 发布包
            log(`${progress} 📦 发布中: ${name}@${version}...`);
            const command = `npm publish "${filePath}" --provenance=false --registry=${registry}`;
            execSync(command, { stdio: 'ignore' });
            log(`${progress} ✅ 发布成功: ${name}@${version}`);
            successCount++;
        } catch (err) {
            log(`${progress} ❌ 发布失败: ${name}@${version}`);
            log(`    错误信息: ${err.message}`, false);
            failureCount++;
        }

        log('--------------------------------------------------');
    }

    // 输出统计信息
    log('\n📊 发布统计:');
    log(`  总包数: ${files.length}`);
    log(`  ✅ 成功: ${successCount}`);
    log(`  ⏩ 跳过: ${skippedCount}`);
    log(`  ❌ 失败: ${failureCount}`);

    log(`\n🎉 所有包处理完成！详细日志已保存到 ${logFile}`);
}

// 执行主函数并处理异常
main().catch(error => {
    log(`❌ 执行过程中出错: ${error.message}`);
    process.exit(1);
});